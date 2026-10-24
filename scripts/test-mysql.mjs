// Integration check against a disposable LOCAL MariaDB, never Cybrancee.
// Requires mariadbd + mariadb-install-db. All fixtures and DB files live in /tmp.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "plesk");
const mysql = createRequire(path.join(root, "lib/db/package.json"))("mysql2/promise");
const io = createRequire(path.join(root, "artifacts/biz-connect/package.json"))("socket.io-client").io;
const temp = await mkdtemp(path.join(os.tmpdir(), "bca-mysql-test-"));
let daemon, server, connection;
const sockets = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
async function stop(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const ended = once(process, "exit");
  process.kill("SIGTERM");
  const timeout = setTimeout(() => process.kill("SIGKILL"), 3000);
  await ended; clearTimeout(timeout);
}
function run(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: app, env, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}
try {
  const initialized = spawnSync("mariadb-install-db", [
    "--no-defaults", `--datadir=${temp}/db`, "--auth-root-authentication-method=normal", "--skip-test-db",
    "--innodb-use-native-aio=0", "--skip-ssl",
  ], { encoding: "utf8", timeout: 30000 });
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  const port = await freePort();
  daemon = spawn("mariadbd", ["--no-defaults", `--datadir=${temp}/db`, `--socket=${temp}/db.sock`,
    `--pid-file=${temp}/db.pid`, `--port=${port}`, "--bind-address=127.0.0.1",
    "--innodb-buffer-pool-size=32M", "--innodb-use-native-aio=0", "--skip-ssl",
    "--max-connections=20", `--log-error=${temp}/db.log`],
  { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    assert.equal(daemon.exitCode, null, "Temporary MariaDB failed to start");
    try { connection = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", multipleStatements: true }); break; }
    catch { await delay(100); }
  }
  assert(connection, "Temporary MariaDB did not become ready");
  await connection.query("CREATE DATABASE bca_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
  await connection.query("USE bca_test");
  const schema = await readFile(path.join(app, "schema/initial-mysql.sql"), "utf8");
  assert(!/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)\b/i.test(schema), "No destructive initialization");
  await connection.query(schema);
  // Least-privilege runtime account: startup and diagnose must not need DDL.
  const password = "local-fixture@:/ %";
  await connection.query("CREATE USER 'bca_fixture'@'127.0.0.1' IDENTIFIED BY ?", [password]);
  await connection.query("GRANT SELECT, INSERT, UPDATE, DELETE ON bca_test.* TO 'bca_fixture'@'127.0.0.1'");
  const env = { ...process.env, NODE_ENV: "production", APP_ORIGIN: "https://bca.test",
    SESSION_SECRET: randomBytes(32).toString("hex"), STORAGE_DIR: path.join(temp, "private"),
    CYBRANCEE_DB_HOST: "127.0.0.1", CYBRANCEE_DB_PORT: String(port), CYBRANCEE_DB_NAME: "bca_test",
    CYBRANCEE_DB_USER: "bca_fixture", CYBRANCEE_DB_PASSWORD: password, VAPID_SUBJECT: "",
    ADMIN_USERNAME: "Support vérification", ADMIN_PASSWORD: "temporary-admin-password",
    MEMBER_USERNAME: "Membre é 👋", MEMBER_NUMBER: "+237600000101" };
  run(["admin.cjs"], env);
  run(["admin.cjs"], env); // Idempotent create, not an automatic password reset.
  run(["member.cjs"], env);
  run(["member.cjs"], { ...env, MEMBER_USERNAME: "Autre membre", MEMBER_NUMBER: "+237600000102" });
  assert.match(run(["diagnose.cjs"], env), /Connexion MySQL\/MariaDB et requête en lecture seule réussies/);
  // A missing schema must be reported, not silently created.
  await connection.query("CREATE DATABASE bca_empty");
  await connection.query("GRANT SELECT, INSERT, UPDATE, DELETE ON bca_empty.* TO 'bca_fixture'@'127.0.0.1'");
  const empty = spawnSync(process.execPath, ["diagnose.cjs"], {
    cwd: app, env: { ...env, CYBRANCEE_DB_NAME: "bca_empty" }, encoding: "utf8", timeout: 20000,
  });
  assert.equal(empty.status, 1); assert.match(empty.stdout, /BCA_SCHEMA_MISSING/);
  const [emptyTables] = await connection.query("SHOW TABLES FROM bca_empty");
  assert.equal(emptyTables.length, 0, "Diagnose/startup must not initialize tables");

  const httpPort = await freePort();
  let logs = "";
  server = spawn(process.execPath, ["app.cjs"], { cwd: app, env: { ...env, PORT: String(httpPort) }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b) => { logs += b; });
  server.stderr.on("data", (b) => { logs += b; });
  const base = `http://127.0.0.1:${httpPort}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    assert.equal(server.exitCode, null, logs);
    try { if ((await fetch(base + "/api/healthz")).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert(ready, logs);
  function browser() {
    const cookies = new Map();
    let csrf = "";
    const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return {
      cookie, csrf: () => csrf,
      async request(route, method = "GET", body, expected = 200) {
        const response = await fetch(base + "/api" + route, { method, headers: {
          "x-forwarded-proto": "https", "x-forwarded-host": "bca.test", origin: "https://bca.test",
          cookie: cookie(), "x-csrf-token": csrf, "content-type": "application/json",
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        for (const raw of response.headers.getSetCookie()) {
          const entry = raw.split(";")[0], equals = entry.indexOf("=");
          cookies.set(entry.slice(0, equals), entry.slice(equals + 1));
        }
        const data = await response.json();
        assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}\n${logs}`);
        if (data.csrfToken) csrf = data.csrfToken;
        return data;
      },
    };
  }
  const member = browser(), admin = browser();
  for (const b of [member, admin]) await b.request("/auth/session");
  assert.equal((await member.request("/auth/login", "POST", { username: env.MEMBER_USERNAME, credential: env.MEMBER_NUMBER })).account.role, "member");
  assert.equal((await admin.request("/auth/login", "POST", { username: env.ADMIN_USERNAME, credential: env.ADMIN_PASSWORD })).account.role, "admin");
  const mine = await member.request("/conversations");
  assert.equal(mine.length, 1); assert.equal(typeof mine[0].favorite, "boolean");
  const id = mine[0].id;
  assert.equal((await admin.request("/conversations")).length, 0);
  const [others] = await connection.query("SELECT id FROM conversations WHERE id <> ?", [id]);
  await member.request(`/conversations/${others[0].id}/messages`, "GET", undefined, 404);
  await member.request(`/conversations/${id}`, "PATCH", { favorite: true }, 403);
  const text = "Bonjour 👋 — café et apostrophe ' : MySQL/MariaDB";
  const sent = await member.request(`/conversations/${id}/messages`, "POST", { type: "text", content: text });
  assert.equal(sent.content, text); assert.equal(sent.status, "sent");
  const avatar = randomUUID();
  await connection.query("UPDATE users SET avatar_file_id = ? WHERE username = ?", [avatar, env.MEMBER_USERNAME]);
  const inbox = await admin.request("/conversations");
  assert.equal(inbox.length, 1); assert.equal(inbox[0].unreadCount, 1);
  assert.equal(inbox[0].messageCount, 1); assert.equal(inbox[0].avatarUrl, `/api/files/${avatar}`);
  const delivered = await admin.request(`/conversations/${id}/messages`);
  assert.equal(delivered[0].status, "delivered"); assert.equal(delivered[0].senderAvatarUrl, `/api/files/${avatar}`);
  await admin.request(`/conversations/${id}/read`, "POST");
  assert.equal((await member.request(`/conversations/${id}/messages`))[0].status, "read");
  await admin.request(`/conversations/${id}`, "PATCH", { favorite: true });
  assert.equal((await admin.request("/conversations?filter=favorites"))[0].favorite, true);
  await admin.request(`/conversations/${id}/messages`, "POST", { type: "text", content: "Réponse support 👋" });
  assert.equal((await member.request("/conversations"))[0].unreadCount, 1);
  await member.request(`/conversations/${id}/read`, "POST");
  assert.equal((await admin.request("/conversations/summary")).unreadMessages, 0);
  for (const b of [member, admin]) {
    const socket = io(base, { path: "/api/socket.io", transports: ["websocket"], reconnection: false,
      auth: { csrfToken: b.csrf() }, extraHeaders: { Cookie: b.cookie(), Origin: "https://bca.test" } });
    sockets.push(socket);
    socket.on("message:new", ({ conversationId, message }) => {
      if (message.senderRole !== (b === member ? "member" : "admin")) socket.emit("message:received", { conversationId, messageId: message.id });
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket connection timed out")), 5000);
      socket.once("connect", () => { clearTimeout(timeout); resolve(); });
      socket.once("connect_error", (e) => { clearTimeout(timeout); reject(e); });
    });
  }
  for (let i = 0; i < 30; i++) {
    const [presence] = await connection.query("SELECT account_id FROM presence");
    if (presence.length === 2) break;
    await delay(50);
  }
  const [presence] = await connection.query("SELECT account_id FROM presence");
  assert.equal(presence.length, 2, "Presence.upsert must work with MySQL");
  assert.equal((await member.request("/conversations"))[0].online, true);
  const liveMessage = await member.request(`/conversations/${id}/messages`, "POST", { type: "text", content: "Support en ligne" });
  assert.equal(liveMessage.status, "sent", "Delivery requires a real recipient acknowledgment");
  for (let i = 0; i < 20; i++) {
    if ((await member.request(`/conversations/${id}/messages`)).find((m) => m.id === liveMessage.id)?.status === "delivered") break;
    await delay(50);
  }
  assert.equal((await member.request(`/conversations/${id}/messages`)).find((m) => m.id === liveMessage.id)?.status, "delivered");
  assert.equal((await member.request("/auth/refresh", "POST")).account.role, "member");
  await member.request("/auth/logout", "POST");
  await member.request("/conversations", "GET", undefined, 401);
  assert(!logs.includes(password), "Runtime must not log DB credentials");
  console.log("PASS: real disposable MariaDB, initial schema, least-privilege startup, admin/member CLI and login, UTF-8 messages, inbox/avatars/counts/boolean types, delivery/read states, support-only authorization, favorites, sessions and Socket.IO presence. No external database touched.");
} finally {
  for (const socket of sockets) socket.disconnect();
  await stop(server);
  if (connection) await connection.end().catch(() => {});
  await stop(daemon);
  await rm(temp, { recursive: true, force: true });
}

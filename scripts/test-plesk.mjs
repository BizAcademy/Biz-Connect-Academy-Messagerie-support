import assert from "node:assert/strict";
import { spawn, spawnSync, fork } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, cp, rm, readFile, writeFile, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "bca-plesk-"));
const app = path.join(temp, "application");
const privateStorage = path.join(temp, "private-storage");
let child;
let automaticStorage;
function run(args, cwd = app, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  run(["plesk/verify.cjs", "--sources"], root);
  await cp(path.join(root, "plesk"), app, {
    recursive: true,
    filter: (file) => !["node_modules", ".env", ".runtime-dependencies.sha256", ".startup-status.json"].includes(path.basename(file)),
  });
  const env = { ...process.env, NODE_ENV: "production", SESSION_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", STORAGE_DIR: "", APP_ORIGIN: "https://bca.test" };
  for (const k of Object.keys(env)) if (k.startsWith("CYBRANCEE_DB_") || k.startsWith("ADMIN_") || k.startsWith("MEMBER_")) delete env[k];
  run(["deploy.cjs"], app, env);
  const storageProbe = ["-e", "require('./environment.cjs')(); process.stdout.write(process.env.STORAGE_DIR);"];
  automaticStorage = run(storageProbe, app, env);
  assert(path.relative(path.dirname(app), automaticStorage).startsWith(".." + path.sep), "Automatic storage must be outside the Git checkout");
  assert.equal((await stat(automaticStorage)).mode & 0o777, 0o700);
  await writeFile(path.join(automaticStorage, "persistence-check"), "keep-private", { mode: 0o600 });
  assert.equal(run(storageProbe, app, env), automaticStorage, "Storage location must be stable");
  assert.equal(run(storageProbe, app, { ...env, STORAGE_DIR: privateStorage }), privateStorage, "Existing configured storage must remain unchanged");
  for (const dir of ["relative-storage", path.join(app, "public")]) {
    const badStorage = spawnSync(process.execPath, storageProbe, { cwd: app, env: { ...env, STORAGE_DIR: dir }, encoding: "utf8" });
    assert.equal(badStorage.status, 1, "Relative or public storage must be rejected");
  }
  const linkedStorage = path.join(temp, "public-symlink");
  await symlink(path.join(app, "public"), linkedStorage);
  assert.equal(spawnSync(process.execPath, storageProbe, { cwd: app, env: { ...env, STORAGE_DIR: linkedStorage }, encoding: "utf8" }).status, 1, "Symlinks must not expose private files in public");
  const require = createRequire(path.join(app, "package.json"));
  const { testInit } = await import("./test-db-init.mjs");
  await testInit(require("./init-db.cjs").initializeDatabase);
  await import("./test-db-upgrade.mjs");
  for (const name of ["sequelize", "mysql2", "pg", "sharp"]) {
    assert(require.resolve(name).startsWith(path.join(app, "node_modules")), "Must not depend on workspace node_modules");
  }
  assert.match(run(["deploy.cjs"], app, env), /aucune installation nécessaire/);
  assert.equal(await readFile(path.join(automaticStorage, "persistence-check"), "utf8"), "keep-private", "Deploy must preserve private attachments");
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let logs = "";
  child = spawn(process.execPath, ["app.cjs"], { cwd: app, env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => { logs += b; });
  child.stderr.on("data", (b) => { logs += b; });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("Isolated startup failed: " + logs);
    try { if ((await fetch(base + "/api/healthz")).ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "Compiled server did not start");
  const headers = { "x-forwarded-proto": "https", "x-forwarded-host": "bca.test" };
  const response = await fetch(base + "/", { headers });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /BCA Messenger/);
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(asset); assert.equal((await fetch(base + asset, { headers })).status, 200);
  const manifest = await (await fetch(base + "/manifest.webmanifest", { headers })).json();
  assert.equal(manifest.name, "BCA Messenger");
  assert.equal((await fetch(base + "/sw.js", { headers })).status, 200);
  const sessionResponse = await fetch(base + "/api/auth/session", { headers });
  const session = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200); assert.equal(session.demoAvailable, false);
  const cookie = sessionResponse.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const demo = await fetch(base + "/api/auth/demo", { method: "POST",
    headers: { ...headers, cookie, "content-type": "application/json", "x-csrf-token": session.csrfToken },
    body: JSON.stringify({ role: "member" }) });
  assert.equal(demo.status, 404);
  assert.equal((await fetch(base + "/")).status, 426, "HTTPS remains mandatory in production");
  const hidden = await (await fetch(base + "/server/index.mjs", { headers })).text();
  assert.match(hidden, /<!doctype html>/i, "Server bundle must never be exposed as a static asset");
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  child = null;
  const saved = JSON.parse(await readFile(path.join(app, ".startup-status.json"), "utf8"));
  assert.equal(saved.stage, "ready");
  const diagnosis = run(["diagnose.cjs", "--skip-db"], app, env);
  assert.match(diagnosis, /Serveur compilé démarré/);
  assert(!diagnosis.includes(env.SESSION_SECRET), "Diagnostic must not leak secrets");
  assert.equal(JSON.parse(await readFile(path.join(app, ".startup-status.json"), "utf8")).at, saved.at, "Diagnostic must not overwrite the Passenger report");
  const dbDiagnosis = spawnSync(process.execPath, ["diagnose.cjs"], { cwd: app, env, encoding: "utf8", timeout: 20000 });
  assert.equal(dbDiagnosis.status, 1);
  assert.match(dbDiagnosis.stdout, /ECONNREFUSED/);
  assert(!dbDiagnosis.stdout.includes(env.DATABASE_URL), "Connection errors must not leak credentials");
  assert(!dbDiagnosis.stdout.includes(env.SESSION_SECRET));
  const wrongDialect = spawnSync(process.execPath, ["init-db.cjs"], { cwd: app, env, encoding: "utf8", timeout: 10000 });
  assert.equal(wrongDialect.status, 1); assert.match(wrongDialect.stderr, /BCA_SCHEMA_DIALECT/);
  assert(!wrongDialect.stderr.includes(env.DATABASE_URL));
  const mysqlEnv = { ...env, DATABASE_URL: "mysql://unused:unused@127.0.0.1:1/unused" };
  const failedInit = spawnSync(process.execPath, ["init-db.cjs"], { cwd: app, env: mysqlEnv, encoding: "utf8", timeout: 10000 });
  assert.equal(failedInit.status, 1); assert.match(failedInit.stderr, /ECONNREFUSED/);
  assert(!failedInit.stderr.includes(mysqlEnv.DATABASE_URL));
  assert(!failedInit.stderr.includes(mysqlEnv.SESSION_SECRET));
  assert.match(run(["diagnose.cjs", "--skip-db"], app, mysqlEnv), /Serveur compilé démarré/);
  const mysqlDiagnosis = spawnSync(process.execPath, ["diagnose.cjs"], { cwd: app, env: mysqlEnv, encoding: "utf8", timeout: 20000 });
  assert.equal(mysqlDiagnosis.status, 1); assert.match(mysqlDiagnosis.stdout, /ECONNREFUSED/);
  assert(!mysqlDiagnosis.stdout.includes(mysqlEnv.DATABASE_URL));
  const badEnv = { ...env, SESSION_SECRET: "short-secret-test" };
  const badStartup = spawnSync(process.execPath, ["app.cjs"], { cwd: app, env: badEnv, encoding: "utf8", timeout: 5000 });
  assert.equal(badStartup.status, 1);
  const badReport = JSON.parse(await readFile(path.join(app, ".startup-status.json"), "utf8"));
  assert.equal(badReport.stage, "environment"); assert.equal(badReport.error.code, "BCA_SESSION_SECRET");
  assert(!JSON.stringify(badReport).includes(badEnv.SESSION_SECRET));
  const badDiagnosis = spawnSync(process.execPath, ["diagnose.cjs", "--skip-db"], { cwd: app, env: badEnv, encoding: "utf8", timeout: 5000 });
  assert.equal(badDiagnosis.status, 1); assert.match(badDiagnosis.stdout, /BCA_SESSION_SECRET/);
  assert(!badDiagnosis.stdout.includes(badEnv.SESSION_SECRET));
  const safe = require("./startup-report.cjs").safeError(new Error("private-connection-string-for-test"));
  assert(!safe.message.includes("private-connection-string-for-test"), "Unknown exceptions must not be recorded verbatim");
  const keepalive = path.join(app, "passenger-keepalive-test.cjs");
  await writeFile(keepalive, "setInterval(() => {}, 1000); process.on('message', () => {}); require('./app.cjs');\n");
  child = fork(keepalive, [], { cwd: app, env: badEnv, silent: true });
  child.stdout.resume(); child.stderr.resume();
  const heldOpenChild = child;
  const timedOut = setTimeout(() => heldOpenChild.kill("SIGKILL"), 4000);
  const heldExit = await new Promise((resolve) => heldOpenChild.once("exit", (code) => resolve(code)));
  clearTimeout(timedOut); child = null;
  assert.equal(heldExit, 1, "Startup failure must exit explicitly even with Passenger-like IPC/timer handles");

  // Four fields suffice; default MySQL port and reserved characters are safe.
  run(["-e", `require('./environment.cjs')(); const u=new URL(process.env.DATABASE_URL); if(u.protocol!=='mysql:'||u.port!=='3306'||decodeURIComponent(u.password)!=='p@ss:/ %') process.exit(1);`], app,
    { ...env, CYBRANCEE_DB_HOST: "127.0.0.1", CYBRANCEE_DB_NAME: "bca", CYBRANCEE_DB_USER: "test", CYBRANCEE_DB_PASSWORD: "p@ss:/ %" });
  run(["-e", `require('./environment.cjs')(); if(new URL(process.env.DATABASE_URL).port!=='3307') process.exit(1);`], app,
    { ...env, CYBRANCEE_DB_HOST: "127.0.0.1", CYBRANCEE_DB_PORT: "3307", CYBRANCEE_DB_NAME: "bca", CYBRANCEE_DB_USER: "test", CYBRANCEE_DB_PASSWORD: "test" });
  const runtimePackage = JSON.parse(await readFile(path.join(app, "package.json"), "utf8"));
  assert(!runtimePackage.devDependencies && !runtimePackage.scripts.build && !runtimePackage.scripts.postinstall);
  await writeFile(path.join(app, "server/index.mjs"), "// incomplete deployment");
  const broken = spawnSync(process.execPath, ["app.cjs"], { cwd: app, env, encoding: "utf8", timeout: 5000 });
  assert.equal(broken.status, 1, "Incomplete release must fail instead of compiling");
  assert.match(broken.stderr, /incomplète ou modifiée/);
  console.log("PASS: isolated prebuilt startup, runtime dependencies without a build, cached deployment, HTML/assets/PWA/API, HTTPS, safe URL encoding, incomplete release rejected, bounded diagnostic, persistent private startup report and secrets never printed.");
} finally {
  if (child) { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
  if (automaticStorage) await rm(automaticStorage, { recursive: true, force: true });
  await rm(temp, { recursive: true, force: true });
}

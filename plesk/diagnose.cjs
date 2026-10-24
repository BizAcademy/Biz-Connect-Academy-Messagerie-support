"use strict";
// Bounded command for Plesk "Run script". No DDL, writes to the DB, secrets,
// dependency installation, compilation, or permanent second application server.
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { fork } = require("node:child_process");
const report = require("./startup-report.cjs");
const { verifyRelease } = require("./verify.cjs");
let failures = 0;
const ok = (text) => console.log("[OK] " + text);
function fail(label, error) {
  failures++;
  const safe = report.safeError(error);
  console.log(`[ERREUR] ${label} : ${safe.code} — ${safe.message}`);
}
async function localStartup() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = fork(path.join(__dirname, "app.cjs"), [], {
    cwd: __dirname, env: { ...process.env, BCA_DIAGNOSTIC: "1", PORT: String(port) }, silent: true,
  });
  // Drain without forwarding potentially sensitive output from third parties.
  child.stdout.resume(); child.stderr.resume();
  let exited = false;
  const exit = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("Aucune réponse du serveur de test en 10 secondes."), { code: "BCA_STARTUP_TIMEOUT" })), 10000);
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once("error", finish);
      child.once("exit", () => finish(Object.assign(new Error("Le processus a quitté avant de démarrer."), { code: "BCA_CHILD_EXIT" })));
      child.on("message", (message) => {
        if (message?.type === "bca-ready") finish();
        if (message?.type === "bca-startup-error") finish(Object.assign(new Error(message.error.message), { code: message.error.code }));
      });
    });
    await new Promise((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port, path: "/api/healthz", timeout: 2000 }, (response) => {
        let body = "";
        response.on("data", (b) => { if (body.length < 1000) body += b; });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200 || JSON.parse(body).status !== "ok") throw new Error();
            resolve();
          } catch { reject(Object.assign(new Error("Le serveur local ne répond pas correctement à /api/healthz."), { code: "BCA_LOCAL_HEALTH" })); }
        });
      });
      request.once("error", reject);
      request.once("timeout", () => request.destroy(Object.assign(new Error("Délai de réponse local dépassé."), { code: "BCA_LOCAL_HEALTH" })));
    });
    ok("Serveur compilé démarré et /api/healthz local répond : le test temporaire sera arrêté.");
  } finally {
    if (!exited) child.kill("SIGTERM");
    const killed = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, 1000);
    await exit; clearTimeout(killed);
  }
}
async function database() {
  const expected = ["users", "admins", "conversations", "messages", "files", "sessions", "presence", "push_subscriptions"];
  let names;
  if (/^(mysql|mariadb):/.test(process.env.DATABASE_URL)) {
    const mysql = require("mysql2/promise");
    const client = await mysql.createConnection({
      uri: process.env.DATABASE_URL.replace(/^mariadb:/, "mysql:"),
      connectTimeout: 5000, timezone: "Z",
    });
    try {
      // No DDL, account creation, row changes or implicit schema sync.
      await client.query({ sql: "START TRANSACTION READ ONLY", timeout: 4000 });
      const [rows] = await client.query({
        sql: "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
        timeout: 4000,
      });
      names = rows.map((r) => r.name);
      ok("Connexion MySQL/MariaDB et requête en lecture seule réussies.");
    } finally { client.destroy(); }
  } else {
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000, query_timeout: 4000, statement_timeout: 4000,
    options: "-c default_transaction_read_only=on" });
  client.on("error", () => {});
  try {
    await client.connect();
    const tables = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])", [expected]);
    ok("Connexion PostgreSQL et requête en lecture seule réussies.");
    names = tables.rows.map((r) => r.tablename);
  } finally { await client.end().catch(() => {}); }
  }
  const present = new Set(names);
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length) fail("Schéma", Object.assign(new Error("Tables absentes : " + missing.join(", ") + ". Aucune migration n'a été exécutée."), { code: "BCA_SCHEMA_MISSING" }));
  else ok("Toutes les tables attendues sont présentes.");
}
(async () => {
  console.log("BCA Messenger — diagnostic privé sans affichage des secrets.");
  console.log("Node.js : " + process.version + ". Aucune compilation.");
  const previous = report.read();
  if (previous) {
    console.log(`Dernier démarrage Passenger : ${previous.stage} (${previous.at}).`);
    if (previous.error) console.log(`Erreur enregistrée : ${previous.error.code} — ${previous.error.message}`);
  } else console.log("Aucun rapport de démarrage disponible. Redémarrer l'application après ce déploiement pour en créer un.");
  try { verifyRelease(); ok("Fichiers de la distribution vérifiés."); }
  catch { fail("Distribution", Object.assign(new Error("Distribution absente, incomplète ou modifiée. Redéployer tout plesk/."), { code: "BCA_RELEASE" })); return; }
  try { require("./environment.cjs")(); ok("Variables requises valides dans cette commande (valeurs masquées)."); }
  catch (e) {
    fail("Configuration", e);
    console.log("Les variables du panneau Node.js ne sont pas toujours transmises aux commandes. Un fichier plesk/.env privé permet de les partager. Ne le publiez jamais sur GitHub.");
    return;
  }
  for (const name of ["sequelize", "mysql2", "pg", "sharp", "@ffprobe-installer/ffprobe"]) {
    try { require(name); ok("Module " + name + " chargeable."); }
    catch (e) { fail("Module " + name, e); }
  }
  if (failures) return;
  try {
    const probe = require("@ffprobe-installer/ffprobe").path;
    const result = require("node:child_process").spawnSync(probe, ["-version"], { timeout: 5000, stdio: "ignore" });
    if (result.status !== 0) throw new Error("Exécution audio impossible. Relancer deploy et vérifier les droits d’exécution de l’hébergement.");
    ok("Vérification des vocaux disponible, sans installation système manuelle.");
  } catch (e) { fail("Vocaux", e); }
  try { await localStartup(); }
  catch (e) { fail("Démarrage local", e); }
  if (!process.argv.includes("--skip-db")) {
    try { await database(); }
    catch (e) { fail("Connexion à la base", e); }
  }
  if (!failures) console.log("Diagnostic réussi. Si l'URL publique reste en 504, contrôler le démarrage Passenger et le proxy Plesk : ce test local ne prouve pas leur bon fonctionnement.");
})().catch((e) => fail("Diagnostic", e)).finally(() => {
  console.log(failures ? `Diagnostic terminé : ${failures} point(s) bloquant(s).` : "Diagnostic terminé.");
  process.exitCode = failures ? 1 : 0;
});

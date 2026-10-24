"use strict";
// Explicit one-time setup only. Never imported by startup or Deploy Now.
const fs = require("node:fs");
const path = require("node:path");
const { safeError } = require("./startup-report.cjs");
const expected = ["users", "admins", "presence", "sessions", "conversations", "files", "messages", "push_subscriptions"];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const lock = "CONCAT('bca-init-', LEFT(SHA2(DATABASE(), 256), 24))";
async function tableNames(client) {
  const [rows] = await client.query({
    sql: "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    timeout: 5000,
  });
  return rows.map((r) => r.name);
}
async function initializeDatabase(client, script) {
  // This parser deliberately accepts only our simple versioned initial schema.
  // No multipleStatements, identifiers from user input, or destructive queries.
  const statements = script.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  const names = [];
  for (const statement of statements) {
    const match = /^CREATE TABLE ([a-z_]+)\s*\(/i.exec(statement);
    if (match) names.push(match[1]);
    else if (!/^SET NAMES utf8mb4$/i.test(statement) && !/^SET time_zone\s*=\s*'\+00:00'$/i.test(statement)) {
      fail("BCA_SCHEMA_SCRIPT", "Le schéma initial contient une instruction non autorisée. Aucune création effectuée.");
    }
  }
  if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) {
    fail("BCA_SCHEMA_SCRIPT", "Le schéma initial ne correspond pas aux huit tables attendues. Aucune création effectuée.");
  }
  let acquired = false;
  let creationStarted = false;
  try {
    const [rows] = await client.query({ sql: `SELECT GET_LOCK(${lock}, 5) AS acquired`, timeout: 6000 });
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) fail("BCA_SCHEMA_BUSY", "Une autre initialisation est en cours. Aucun changement effectué par cette commande.");
    const existing = await tableNames(client);
    if (expected.every((name) => existing.includes(name))) return "already-present";
    if (existing.length) fail("BCA_SCHEMA_NOT_EMPTY", "La base contient déjà des tables. Initialisation refusée : aucune table modifiée ou supprimée. Lancer diagnose pour examiner le schéma.");
    for (const sql of statements) {
      if (/^CREATE TABLE /i.test(sql)) creationStarted = true;
      await client.query({ sql, timeout: 5000 });
    }
    const present = await tableNames(client);
    if (!expected.every((name) => present.includes(name))) fail("BCA_SCHEMA_VERIFY", "Les huit tables n'ont pas toutes été créées.");
    return "created";
  } catch (error) {
    if (creationStarted) {
      const code = /^[A-Z0-9_]{1,60}$/.test(error?.code || "") ? error.code : "UNKNOWN";
      // MySQL DDL is not transactional. Never hide a partial import or retry it.
      fail("BCA_SCHEMA_INIT_FAILED", `Création interrompue (${code}). Certaines tables peuvent avoir été créées. Aucune suppression ni réinitialisation automatique. Lancer diagnose avant toute nouvelle tentative.`);
    }
    throw error;
  } finally {
    if (acquired) await client.query({ sql: `SELECT RELEASE_LOCK(${lock})`, timeout: 3000 }).catch(() => {});
  }
}
async function main() {
  let client;
  try {
    try { require("./verify.cjs").verifyRelease(); }
    catch { fail("BCA_RELEASE", "Distribution incomplète ou modifiée. Redéployer plesk/ avant l'initialisation."); }
    require("./environment.cjs")();
    if (!/^(mysql|mariadb):/.test(process.env.DATABASE_URL)) {
      fail("BCA_SCHEMA_DIALECT", "Cette commande initialise uniquement une base MySQL/MariaDB externe vide.");
    }
    client = await require("mysql2/promise").createConnection({
      uri: process.env.DATABASE_URL.replace(/^mariadb:/, "mysql:"),
      connectTimeout: 5000, timezone: "Z", multipleStatements: false,
    });
    const result = await initializeDatabase(client, fs.readFileSync(path.join(__dirname, "schema/initial-mysql.sql"), "utf8"));
    console.log(result === "created"
      ? "[OK] Les huit tables de BCA Messenger ont été créées. Aucune donnée existante supprimée."
      : "[INFO] Les huit tables sont déjà présentes. Aucune création ni modification effectuée.");
    console.log("Aucun compte administrateur ou membre créé. Lancer diagnose pour vérifier la base.");
  } catch (error) {
    const safe = safeError(error);
    console.error(`[ERREUR] ${safe.code} — ${safe.message}`);
    process.exitCode = 1;
  } finally { if (client) client.destroy(); }
}
module.exports = { initializeDatabase };
if (require.main === module) main();

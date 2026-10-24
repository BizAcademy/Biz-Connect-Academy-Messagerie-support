"use strict";
// Explicit external-MySQL upgrade. Never called by startup or Deploy Now.
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
async function upgradePairIndex(client) {
  let acquired = false;
  const identifier = (name) => "`" + String(name).replace(/`/g, "``") + "`";
  const inspect = async () => {
    const [rows] = await client.query({ sql: "SHOW INDEX FROM users", timeout: 5000 });
    const groups = new Map();
    for (const r of rows) {
      if (Number(r.Non_unique) !== 0 || r.Key_name === "PRIMARY") continue;
      if (!groups.has(r.Key_name)) groups.set(r.Key_name, []);
      groups.get(r.Key_name).push(r);
    }
    return [...groups].map(([name, cols]) => ({
      name, columns: cols.sort((a, b) => a.Seq_in_index - b.Seq_in_index).map((c) => c.Column_name),
      complete: cols.every((c) => c.Sub_part == null),
    }));
  };
  try {
    const [lock] = await client.query({ sql: "SELECT GET_LOCK(CONCAT('bca-upgrade-', LEFT(SHA2(DATABASE(),256),24)),5) AS acquired", timeout: 6000 });
    acquired = Number(lock[0]?.acquired) === 1;
    if (!acquired) fail("BCA_SCHEMA_BUSY", "Une autre mise à jour est en cours.");
    let indexes = await inspect();
    if (!indexes.some((i) => i.complete && i.columns.join(",") === "username,phone")) {
      // Add the replacement protection BEFORE removing the old restriction.
      // If creation fails, the original unique-name protection stays in place.
      await client.query({ sql: "ALTER TABLE users ADD UNIQUE INDEX bca_member_pair_unique (username, phone)", timeout: 20000 });
    }
    for (const index of indexes.filter((i) => i.columns.join(",") === "username")) {
      await client.query({ sql: `ALTER TABLE users DROP INDEX ${identifier(index.name)}`, timeout: 20000 });
    }
    indexes = await inspect();
    if (!indexes.some((i) => i.complete && i.columns.join(",") === "username,phone")
      || indexes.some((i) => i.columns.join(",") === "username")) {
      fail("BCA_SCHEMA_UPGRADE", "La vérification de l’index des sessions a échoué. Aucune donnée n’a été supprimée.");
    }
  } finally {
    if (acquired) await client.query({ sql: "SELECT RELEASE_LOCK(CONCAT('bca-upgrade-', LEFT(SHA2(DATABASE(),256),24)))", timeout: 3000 }).catch(() => {});
  }
}
async function main() {
  let client;
  try {
    require("./verify.cjs").verifyRelease();
    require("./environment.cjs")();
    if (!/^(mysql|mariadb):/.test(process.env.DATABASE_URL)) fail("BCA_SCHEMA_DIALECT", "Cette commande est réservée à MySQL/MariaDB sur Plesk.");
    client = await require("mysql2/promise").createConnection({
      uri: process.env.DATABASE_URL.replace(/^mariadb:/, "mysql:"), connectTimeout: 5000, multipleStatements: false,
    });
    await upgradePairIndex(client);
    console.log("[OK] Sessions par nom et téléphone prêtes. Comptes, conversations et messages conservés. Redémarrez l’application.");
  } catch (error) {
    const safe = require("./startup-report.cjs").safeError(error);
    console.error(`[ERREUR] ${safe.code} — ${safe.message}`);
    console.error("Mise à jour non confirmée. Ne supprimez aucune table. Vérifiez les droits ALTER/INDEX et relancez cette commande après correction.");
    process.exitCode = 1;
  } finally { if (client) client.destroy(); }
}
module.exports = { upgradePairIndex };
if (require.main === module) main();

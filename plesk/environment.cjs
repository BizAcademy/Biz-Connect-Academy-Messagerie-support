"use strict";
const fs = require("node:fs");
const path = require("node:path");
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

module.exports = function prepareEnvironment() {
  if (Number(process.versions.node.split(".")[0]) < 22) fail("BCA_NODE_VERSION", "Node.js 22 ou supérieur est requis.");
  const root = __dirname;
  if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
  process.env.NODE_ENV = "production";
  process.env.ENABLE_DEMO = "false";
  process.env.SERVE_STATIC = "true";
  process.env.STATIC_DIR = path.join(root, "public");
  process.env.PORT ||= "3000"; // Passenger intercepts listen() in this process.

  const keys = ["CYBRANCEE_DB_HOST", "CYBRANCEE_DB_PORT", "CYBRANCEE_DB_NAME", "CYBRANCEE_DB_USER", "CYBRANCEE_DB_PASSWORD"];
  if (keys.some((k) => process.env[k])) {
    const missing = keys.filter((k) => !process.env[k]);
    if (missing.length) fail("BCA_DB_FIELDS", `Variables manquantes : ${missing.join(", ")}.`);
    const port = Number(process.env.CYBRANCEE_DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("BCA_DB_PORT", "Port PostgreSQL invalide.");
    if (port === 3306) fail("BCA_DB_MYSQL", "Cette application exige PostgreSQL, pas MySQL/MariaDB.");
    const url = new URL("postgresql://localhost");
    url.hostname = process.env.CYBRANCEE_DB_HOST.trim();
    url.port = String(port);
    // URL setters leave literal '%' intact; encode first so pg can safely decode
    // passwords/usernames containing %, @, /, spaces or other reserved characters.
    url.username = encodeURIComponent(process.env.CYBRANCEE_DB_USER);
    url.password = encodeURIComponent(process.env.CYBRANCEE_DB_PASSWORD);
    url.pathname = "/" + encodeURIComponent(process.env.CYBRANCEE_DB_NAME);
    process.env.DATABASE_URL = url.toString();
  }
  if (!process.env.DATABASE_URL || !/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL)) {
    fail("BCA_DB_URL", "Configurer une connexion PostgreSQL dans les variables Plesk.");
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    fail("BCA_SESSION_SECRET", "SESSION_SECRET doit contenir au moins 32 caractères et rester identique après les déploiements.");
  }
  if (!process.env.STORAGE_DIR || !path.isAbsolute(process.env.STORAGE_DIR)) {
    fail("BCA_STORAGE_DIR", "STORAGE_DIR doit être un chemin absolu vers un dossier privé persistant, hors du dépôt déployé.");
  }
  const relativeStorage = path.relative(root, path.resolve(process.env.STORAGE_DIR));
  if (!relativeStorage.startsWith(".." + path.sep) && relativeStorage !== "..") {
    fail("BCA_STORAGE_PRIVATE", "Le stockage privé doit être situé hors du dossier plesk/.");
  }
  if (!process.env.APP_ORIGIN) fail("BCA_APP_ORIGIN", "Configurer APP_ORIGIN avec l'adresse HTTPS du domaine.");
  let origin;
  try { origin = new URL(process.env.APP_ORIGIN); }
  catch { fail("BCA_APP_ORIGIN", "APP_ORIGIN doit être une origine HTTPS valide."); }
  if (origin.protocol !== "https:" || origin.origin !== process.env.APP_ORIGIN) {
    fail("BCA_APP_ORIGIN", "APP_ORIGIN doit être une origine HTTPS sans chemin ni barre oblique finale.");
  }
  process.chdir(root);
};

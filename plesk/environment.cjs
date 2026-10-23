"use strict";
const fs = require("node:fs");
const path = require("node:path");

module.exports = function prepareEnvironment() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 ou supérieur est requis.");
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
    if (missing.length) throw new Error(`Variables manquantes : ${missing.join(", ")}.`);
    const port = Number(process.env.CYBRANCEE_DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port PostgreSQL invalide.");
    if (port === 3306) throw new Error("Cette application exige PostgreSQL, pas MySQL/MariaDB.");
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
    throw new Error("Configurer une connexion PostgreSQL dans les variables Plesk.");
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET doit contenir au moins 32 caractères et rester identique après les déploiements.");
  }
  if (!process.env.STORAGE_DIR || !path.isAbsolute(process.env.STORAGE_DIR)) {
    throw new Error("STORAGE_DIR doit être un chemin absolu vers un dossier privé persistant, hors du dépôt déployé.");
  }
  const relativeStorage = path.relative(root, path.resolve(process.env.STORAGE_DIR));
  if (!relativeStorage.startsWith(".." + path.sep) && relativeStorage !== "..") {
    throw new Error("Le stockage privé doit être situé hors du dossier plesk/.");
  }
  if (!process.env.APP_ORIGIN) throw new Error("Configurer APP_ORIGIN avec l'adresse HTTPS du domaine.");
  const origin = new URL(process.env.APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== process.env.APP_ORIGIN) {
    throw new Error("APP_ORIGIN doit être une origine HTTPS sans chemin ni barre oblique finale.");
  }
  process.chdir(root);
};

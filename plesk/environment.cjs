"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
function prepareStorage(root) {
  const automatic = !process.env.STORAGE_DIR;
  // Plesk keeps the Git checkout in the parent of this distribution. Its
  // sibling is outside Deploy Now's files and outside the document root.
  const base = path.resolve(root, "..", "..", ".bca-messenger-private");
  const site = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const directory = process.env.STORAGE_DIR || path.join(base, site);
  if (!path.isAbsolute(directory)) {
    fail("BCA_STORAGE_DIR", "Un chemin de stockage personnalisé doit être absolu. Supprimer STORAGE_DIR pour utiliser le stockage privé automatique.");
  }
  if (inside(root, directory)) {
    fail("BCA_STORAGE_PRIVATE", "Le stockage privé ne peut pas être placé dans le dossier applicatif ou public.");
  }
  try {
    if (automatic) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const resolved = fs.realpathSync(directory);
    if (inside(fs.realpathSync(root), resolved)) {
      fail("BCA_STORAGE_PRIVATE", "Le stockage privé ne peut pas pointer vers le dossier applicatif ou public.");
    }
    if (automatic && inside(fs.realpathSync(path.dirname(root)), resolved)) {
      fail("BCA_STORAGE_PRIVATE", "Le stockage automatique doit rester hors du dossier déployé.");
    }
    if (automatic) fs.chmodSync(resolved, 0o700);
    if (!fs.statSync(resolved).isDirectory()) throw new Error();
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    process.env.STORAGE_DIR = resolved;
  } catch (error) {
    if (error?.code === "BCA_STORAGE_PRIVATE") throw error;
    fail("BCA_STORAGE_ACCESS", "Impossible de préparer le stockage privé. Vérifier les droits d'écriture de l'utilisateur Node.js dans le dossier parent du dépôt.");
  }
}

module.exports = function prepareEnvironment() {
  if (Number(process.versions.node.split(".")[0]) < 22) fail("BCA_NODE_VERSION", "Node.js 22 ou supérieur est requis.");
  const root = __dirname;
  if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
  process.env.NODE_ENV = "production";
  process.env.ENABLE_DEMO = "false";
  process.env.SERVE_STATIC = "true";
  process.env.STATIC_DIR = path.join(root, "public");
  process.env.PORT ||= "3000"; // Passenger intercepts listen() in this process.

  const keys = ["CYBRANCEE_DB_HOST", "CYBRANCEE_DB_NAME", "CYBRANCEE_DB_USER", "CYBRANCEE_DB_PASSWORD"];
  if (keys.some((k) => process.env[k])) {
    const missing = keys.filter((k) => !process.env[k]);
    if (missing.length) fail("BCA_DB_FIELDS", `Variables manquantes : ${missing.join(", ")}.`);
    const port = Number(process.env.CYBRANCEE_DB_PORT || "3306");
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("BCA_DB_PORT", "Port MySQL/MariaDB invalide.");
    const url = new URL("mysql://localhost");
    url.hostname = process.env.CYBRANCEE_DB_HOST.trim();
    url.port = String(port);
    // URL setters leave literal '%' intact; encode first so drivers safely decode
    // passwords/usernames containing %, @, /, spaces or other reserved characters.
    url.username = encodeURIComponent(process.env.CYBRANCEE_DB_USER);
    url.password = encodeURIComponent(process.env.CYBRANCEE_DB_PASSWORD);
    url.pathname = "/" + encodeURIComponent(process.env.CYBRANCEE_DB_NAME);
    process.env.DATABASE_URL = url.toString();
  }
  if (!process.env.DATABASE_URL || !/^(mysql|mariadb|postgres|postgresql):\/\//.test(process.env.DATABASE_URL)) {
    fail("BCA_DB_URL", "Configurer les quatre variables CYBRANCEE_DB_HOST, CYBRANCEE_DB_NAME, CYBRANCEE_DB_USER et CYBRANCEE_DB_PASSWORD dans Plesk, ou DATABASE_URL.");
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    fail("BCA_SESSION_SECRET", "SESSION_SECRET doit contenir au moins 32 caractères et rester identique après les déploiements.");
  }
  if (!process.env.APP_ORIGIN) fail("BCA_APP_ORIGIN", "Configurer APP_ORIGIN avec l'adresse HTTPS du domaine.");
  let origin;
  try { origin = new URL(process.env.APP_ORIGIN); }
  catch { fail("BCA_APP_ORIGIN", "APP_ORIGIN doit être une origine HTTPS valide."); }
  if (origin.protocol !== "https:" || origin.origin !== process.env.APP_ORIGIN) {
    fail("BCA_APP_ORIGIN", "APP_ORIGIN doit être une origine HTTPS sans chemin ni barre oblique finale.");
  }
  prepareStorage(root);
  process.chdir(root);
};

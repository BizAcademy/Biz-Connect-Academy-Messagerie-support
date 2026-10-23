"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname;
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
  });
}
const sourceInputs = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "artifacts/biz-connect/src", "artifacts/biz-connect/public", "artifacts/biz-connect/index.html",
  "artifacts/biz-connect/package.json", "artifacts/biz-connect/vite.config.ts",
  "artifacts/api-server/src", "artifacts/api-server/package.json", "artifacts/api-server/build.mjs",
  "lib/db/src", "lib/db/drizzle", "lib/api-zod/src", "lib/api-client-react/src",
  "lib/api-spec/openapi.yaml", "scripts/build-standalone.mjs", "scripts/build-plesk.mjs",
  "plesk/app.cjs", "plesk/environment.cjs", "plesk/verify.cjs", "plesk/deploy.cjs", "plesk/deploy.sh",
  "plesk/admin.cjs", "plesk/member.cjs",
];
function sourceDigest(repoRoot = path.dirname(root)) {
  const hash = crypto.createHash("sha256");
  const files = sourceInputs.flatMap((name) => {
    const file = path.join(repoRoot, name);
    if (!fs.existsSync(file)) throw new Error(`Source manquante : ${name}`);
    return fs.statSync(file).isDirectory() ? filesUnder(file) : [file];
  }).sort();
  for (const file of files) {
    hash.update(path.relative(repoRoot, file).split(path.sep).join("/") + "\0");
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}
function releaseFiles() {
  return [
    ...filesUnder(path.join(root, "server")), ...filesUnder(path.join(root, "public")),
    ...filesUnder(path.join(root, "schema")),
    ...["package.json", "package-lock.json", "app.cjs", "environment.cjs", "verify.cjs",
      "deploy.cjs", "deploy.sh", "admin.cjs", "member.cjs"].map((f) => path.join(root, f)),
  ].map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
}
function verifyRelease(options = {}) {
  if (!fs.existsSync(path.join(root, "release.json"))) throw new Error("Version précompilée absente. Exécuter npm run build:plesk avant le push, jamais dans Plesk.");
  const release = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8"));
  if (release.format !== 1 || !release.files || !Object.keys(release.files).length) throw new Error("Manifeste de déploiement invalide.");
  for (const [name, expected] of Object.entries(release.files)) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || digest(fs.readFileSync(file)) !== expected) {
      throw new Error(`Version précompilée incomplète ou modifiée : ${name}. Relancer build:plesk avant le push.`);
    }
  }
  for (const required of ["server/index.mjs", "server/admin.mjs", "server/member.mjs", "public/index.html", "schema/initial.sql", "package-lock.json"]) {
    if (!release.files[required]) throw new Error(`Fichier absent du manifeste : ${required}`);
  }
  if (options.sources && sourceDigest() !== release.sourceHash) throw new Error("Les sources ont changé depuis le build. Exécuter npm run build:plesk avant le push GitHub.");
  return release;
}
module.exports = { verifyRelease, releaseFiles, sourceDigest, digest };
if (require.main === module) {
  try {
    const r = verifyRelease({ sources: process.argv.includes("--sources") });
    console.log(`BCA Messenger : version précompilée vérifiée (${Object.keys(r.files).length} fichiers). Aucun build nécessaire.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

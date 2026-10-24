// Run in the build environment before pushing GitHub, never on the Plesk host.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const releaseRoot = path.join(root, "plesk");
const require = createRequire(import.meta.url);
const { sourceDigest, releaseFiles, digest } = require("../plesk/verify.cjs");
const sourceHash = sourceDigest();
function run(command, args, extra = {}) {
  const r = spawnSync(command, args, { cwd: root, stdio: "inherit", ...extra });
  if (r.error || r.status !== 0) throw new Error(`Échec de ${command}. La version n'est pas prête à déployer.`);
}
run(process.execPath, ["scripts/build-standalone.mjs"], {
  env: { ...process.env, BCA_BUILD_MODE: "plesk" },
});
for (const dir of ["server", "public", "schema"]) await rm(path.join(releaseRoot, dir), { recursive: true, force: true });
await mkdir(path.join(releaseRoot, "schema"), { recursive: true });
await cp(path.join(root, "artifacts/api-server/dist"), path.join(releaseRoot, "server"), {
  recursive: true, filter: (file) => !file.endsWith(".map"),
});
await cp(path.join(root, "artifacts/biz-connect/dist/public"), path.join(releaseRoot, "public"), { recursive: true });
const migrations = (await readdir(path.join(root, "lib/db/drizzle"))).filter((f) => f.endsWith(".sql")).sort();
if (migrations.length !== 1) throw new Error("Vérifier manuellement le schéma initial et les migrations externes avant de construire la distribution.");
await cp(path.join(root, "lib/db/drizzle", migrations[0]), path.join(releaseRoot, "schema/initial.sql"));
await cp(path.join(root, "lib/db/mysql/initial.sql"), path.join(releaseRoot, "schema/initial-mysql.sql"));
const apiRequire = createRequire(path.join(root, "artifacts/api-server/package.json"));
const dbRequire = createRequire(path.join(root, "lib/db/package.json"));
async function version(name, resolver) {
  // Some libraries deliberately do not export ./package.json.
  let directory = path.dirname(resolver.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (pkg.name === name) return pkg.version;
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Version introuvable : ${name}`);
    directory = parent;
  }
}
const pkg = {
  name: "bca-messenger-plesk", version: "1.0.0", private: true,
  description: "BCA Messenger — distribution précompilée pour Plesk",
  engines: { node: ">=22.0.0" },
  scripts: { start: "node app.cjs", verify: "node verify.cjs", deploy: "node deploy.cjs", diagnose: "node diagnose.cjs", "db:init": "node init-db.cjs", "db:upgrade": "node upgrade-db.cjs", "admin:create": "node admin.cjs", "member:create": "node member.cjs" },
  dependencies: { mysql2: await version("mysql2", dbRequire), pg: await version("pg", dbRequire), sequelize: await version("sequelize", apiRequire), sharp: await version("sharp", apiRequire), "@ffprobe-installer/ffprobe": await version("@ffprobe-installer/ffprobe", apiRequire) },
};
const packageText = JSON.stringify(pkg, null, 2) + "\n";
const packagePath = path.join(releaseRoot, "package.json");
let previous = "";
try { previous = await readFile(packagePath, "utf8"); } catch {}
await writeFile(packagePath, packageText);
let lockExists = true;
try { await readFile(path.join(releaseRoot, "package-lock.json")); } catch { lockExists = false; }
if (previous !== packageText || !lockExists) {
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], { cwd: releaseRoot });
}
if (sourceDigest() !== sourceHash) throw new Error("Les sources ont changé pendant le build. Relancer build:plesk.");
const files = {};
for (const file of releaseFiles()) files[file] = digest(await readFile(path.join(releaseRoot, file)));
await writeFile(path.join(releaseRoot, "release.json"), JSON.stringify({ format: 1, application: "BCA Messenger", sourceHash, files }, null, 2) + "\n");
run(process.execPath, ["plesk/verify.cjs", "--sources"]);
console.log("Distribution plesk/ prête à être commitée et poussée sur GitHub. Aucun secret ni node_modules inclus.");

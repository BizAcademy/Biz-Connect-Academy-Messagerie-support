"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyRelease, digest } = require("./verify.cjs");

try {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Configurer Node.js 22 ou supérieur pour l'action de déploiement.");
  verifyRelease();
  process.chdir(__dirname);
  const stamp = path.join(__dirname, ".runtime-dependencies.sha256");
  const fingerprint = digest(Buffer.concat([
    fs.readFileSync(path.join(__dirname, "package-lock.json")),
    Buffer.from(`${process.platform}:${process.arch}:${process.versions.modules}`),
  ]));
  let ready = fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === fingerprint;
  if (ready) {
    try { for (const name of ["sharp", "sequelize", "mysql2", "pg", "@ffprobe-installer/ffprobe"]) require(name); }
    catch { ready = false; }
  }
  if (!ready) {
    console.log("Installation des dépendances d'exécution uniquement. Aucun build.");
    // Use npm from the same Node installation selected for the Plesk application.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: __dirname, stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
    });
    if (result.status !== 0) throw new Error("Installation des dépendances échouée. Ne pas redémarrer cette version.");
    for (const name of ["sharp", "sequelize", "mysql2", "pg", "@ffprobe-installer/ffprobe"]) require(name);
    fs.writeFileSync(stamp, fingerprint);
  } else console.log("Dépendances inchangées : aucune installation nécessaire.");
  const audioProbe = require("@ffprobe-installer/ffprobe").path;
  try { fs.accessSync(audioProbe, fs.constants.X_OK); }
  catch { fs.chmodSync(audioProbe, 0o755); }
  const audioCheck = spawnSync(audioProbe, ["-version"], { timeout: 5000, stdio: "ignore" });
  if (audioCheck.status !== 0) throw new Error("Vérification audio indisponible. Vérifier les droits d’exécution de l’hébergement, puis relancer deploy.");
  console.log("Vérification audio prête : aucune installation système de FFprobe nécessaire.");
  console.log("Version prête. Cliquer sur Restart App dans Plesk.");
} catch (error) { console.error(error.message); process.exitCode = 1; }

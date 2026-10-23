"use strict";
try {
  require("./verify.cjs").verifyRelease();
  require("./environment.cjs")();
  if (process.argv.includes("--demo")) throw new Error("La démonstration est interdite en production.");
  import("./server/admin.mjs").catch(() => {
    console.error("Création administrateur échouée. Vérifier la base et les variables ADMIN_USERNAME / ADMIN_PASSWORD.");
    process.exitCode = 1;
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }

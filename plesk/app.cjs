"use strict";
// CommonJS entry point for Passenger. Import in-process: never spawn Node,
// run npm, or compile here, otherwise Passenger cannot manage the HTTP server.
const { verifyRelease } = require("./verify.cjs");
try {
  verifyRelease();
  require("./environment.cjs")();
  for (const dependency of ["sequelize", "pg", "sharp"]) require(dependency);
  import("./server/index.mjs").catch(() => {
    console.error("BCA Messenger : échec du démarrage. Vérifier les variables PostgreSQL et les journaux serveur privés.");
    process.exitCode = 1;
  });
} catch (error) {
  // Errors here contain only our own configuration diagnostics, never DB values.
  const configurationError = !["MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED"].includes(error.code);
  console.error(configurationError ? error.message : "Dépendances manquantes ou incompatibles. Exécuter l'action de déploiement Plesk.");
  process.exitCode = 1;
}

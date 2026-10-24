"use strict";
// CommonJS entry point for Passenger. Import in-process: never spawn Node,
// run npm, or compile here, otherwise Passenger cannot manage the HTTP server.
const { verifyRelease } = require("./verify.cjs");
const report = require("./startup-report.cjs");
let stage = "release";
let timer;
function failed(error) {
  clearTimeout(timer);
  const safe = report.safeError(error);
  report.write(stage, error);
  console.error(`BCA Messenger [${safe.code}] : ${safe.message}`);
  process.exitCode = 1;
  // Passenger can keep its own IPC handles open. exitCode alone would leave a
  // failed startup alive until the proxy returns 504. Flush the diagnostic IPC
  // if present, then exit explicitly instead of keeping an unusable worker.
  if (process.connected) {
    const deadline = setTimeout(() => process.exit(1), 100);
    process.send({ type: "bca-startup-error", error: safe }, () => {
      clearTimeout(deadline);
      process.exit(1);
    });
  } else process.nextTick(() => process.exit(1));
}
try {
  report.write(stage);
  verifyRelease();
  stage = "environment";
  require("./environment.cjs")();
  stage = "dependencies";
  for (const dependency of ["sequelize", "mysql2", "pg", "sharp"]) require(dependency);
  stage = "import";
  report.write(stage);
  timer = setTimeout(() => {
    failed(Object.assign(new Error("Le serveur n'a pas terminé son démarrage en 20 secondes."), { code: "BCA_STARTUP_TIMEOUT" }));
    process.exit(1);
  }, 20000);
  timer.unref();
  import("./server/index.mjs").then(({ server }) => {
    stage = "listen";
    report.write(stage);
    const ready = () => {
      clearTimeout(timer);
      report.write("ready");
      if (process.connected) process.send({ type: "bca-ready" }, () => {});
    };
    if (!server) throw Object.assign(new Error("Bundle serveur obsolète : redéployer la distribution complète."), { code: "BCA_SERVER_BUNDLE" });
    server.once("error", failed);
    if (server.listening) ready(); else server.once("listening", ready);
  }).catch(failed);
} catch (error) {
  // Release integrity messages only name files, not environment values.
  if (stage === "release") error = Object.assign(new Error(error.message), { code: "BCA_RELEASE" });
  failed(error);
}

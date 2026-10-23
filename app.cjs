// Plesk/Passenger entry point. Build before restarting this application.
"use strict";
process.env.NODE_ENV ||= "production";
process.env.PORT ||= "3000";
process.env.SERVE_STATIC = "true";
import("./artifacts/api-server/dist/index.mjs").catch((error) => {
  process.stderr.write(`Startup failed: ${error.message}\n`);
  process.exitCode = 1;
});

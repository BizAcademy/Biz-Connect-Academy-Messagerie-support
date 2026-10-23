// Compatibility entry point; the recommended Plesk Application Root is /plesk.
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
require("./plesk/app.cjs");

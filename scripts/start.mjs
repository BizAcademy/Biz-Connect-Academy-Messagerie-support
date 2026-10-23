import { existsSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
if (existsSync(".env")) process.loadEnvFile(".env");
if (!existsSync("artifacts/biz-connect/dist/public/index.html") || !existsSync("artifacts/api-server/dist/index.mjs")) {
  const r = spawnSync(process.execPath, ["scripts/build-standalone.mjs"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const server = spawn(process.execPath, ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT || "3000", NODE_ENV: process.env.NODE_ENV || "production", SERVE_STATIC: "true" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code || 0));

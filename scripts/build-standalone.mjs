import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const env = { ...process.env, PORT: process.env.PORT || "3000", BASE_PATH: "/", NODE_ENV: "production" };
for (const pkg of ["@workspace/biz-connect", "@workspace/api-server"]) {
  const result = spawnSync("npx", ["--yes", "pnpm@10.26.1", "--filter", pkg, "run", "build"], { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

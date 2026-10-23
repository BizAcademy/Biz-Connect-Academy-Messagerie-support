import { spawnSync } from "node:child_process";
// npm installs the root package, then delegates workspace:* dependencies to
// pnpm. The guard prevents recursion when pnpm runs this lifecycle script.
if ((process.env.npm_config_user_agent || "").startsWith("npm/") && !process.env.BCA_BOOTSTRAP) {
  const r = spawnSync("npx", ["--yes", "pnpm@10.26.1", "install"], {
    stdio: "inherit", env: { ...process.env, BCA_BOOTSTRAP: "1" },
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

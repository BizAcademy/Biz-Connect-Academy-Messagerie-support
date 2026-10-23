import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "node:http";
import { initRealtime } from "./services/realtime";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

export const server = createServer(app);
await initRealtime(server);
server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});
server.on("error", (err) => { logger.error({ err }, "Server error"); process.exitCode = 1; });

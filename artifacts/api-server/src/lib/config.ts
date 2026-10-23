import path from "node:path";
import { createHash } from "node:crypto";

export const production = process.env.NODE_ENV === "production";
export const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
export const jwtKey = sessionSecret;
export const encryptionKey = createHash("sha256")
  .update(process.env.FILE_ENCRYPTION_KEY || sessionSecret).update(":biz-connect-files:v1").digest();
export const storageRoot = path.resolve(process.env.STORAGE_DIR || "./storage");
export const demoAvailable = !production && process.env.ENABLE_DEMO !== "false";
export const appOrigin = process.env.APP_ORIGIN;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { encryptionKey, storageRoot } from "../lib/config";
export { probeAudio } from "./audio-probe";

export async function storePrivate(bytes: Buffer) {
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const name = `${randomUUID()}.enc`;
  await writeFile(path.join(storageRoot, name), Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: "wx" });
  return name;
}
export async function readPrivate(name: string) {
  if (path.basename(name) !== name) throw new Error("Invalid storage path");
  const bytes = await readFile(path.join(storageRoot, name));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
}
export async function removePrivate(name: string) {
  if (path.basename(name) === name) await unlink(path.join(storageRoot, name)).catch(() => {});
}

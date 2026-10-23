import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { encryptionKey, storageRoot } from "../lib/config";

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
// MediaRecorder WebM often omits container duration. Sum actual audio packet
// durations rather than trusting the duration reported by an untrusted client.
export function probeAudio(bytes: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "packet=duration_time", "-of", "csv=p=0", "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Analyse audio trop longue.")); }, 15000);
    child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 2_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 1000) stderr += chunk; });
    child.stdin.on("error", () => {});
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error("Le fichier vocal n'a pas pu être analysé.")); return; }
      const duration = output.split(/\s+/).reduce((sum, line) => sum + (Number.parseFloat(line) || 0), 0);
      if (!Number.isFinite(duration) || duration <= 0) { reject(new Error("Durée audio introuvable.")); return; }
      resolve(duration);
    });
    child.stdin.end(bytes);
  });
}

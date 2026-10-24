import { constants } from "node:fs";
import { access, chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

/** Sniffed container types, including Safari's M4A and WAV aliases. */
export function normalizeVoiceMime(mime: string): string | undefined {
  const types: Record<string, string> = {
    "audio/ogg": "audio/ogg", "video/ogg": "audio/ogg",
    "audio/webm": "audio/webm", "video/webm": "audio/webm",
    "audio/wav": "audio/wav", "audio/vnd.wave": "audio/wav",
    "audio/mpeg": "audio/mpeg",
    "audio/mp4": "audio/mp4", "video/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4",
  };
  return Object.hasOwn(types, mime) ? types[mime] : undefined;
}

let executable: Promise<string> | undefined;
async function audioExecutable() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  executable ??= (async () => {
    const file = ffprobeInstaller.path;
    try { await access(file, constants.X_OK); }
    catch {
      // Hosts may disable npm lifecycle scripts. Only chmod our trusted package
      // binary, never an uploaded file or an arbitrary user-controlled path.
      await chmod(file, 0o755);
      await access(file, constants.X_OK);
    }
    return file;
  })().catch((error) => { executable = undefined; throw error; });
  return executable;
}

/** Inspect actual packets, not the duration supplied by a client or container. */
export async function probeAudio(bytes: Buffer): Promise<number> {
  const file = await audioExecutable();
  const directory = await mkdtemp(path.join(tmpdir(), "bca-voice-"));
  try {
    // A seekable private input also supports Safari MP4s with trailing metadata.
    // Anonymous stdin pipes cannot reliably read those containers.
    await chmod(directory, 0o700);
    const input = path.join(directory, "recording");
    await writeFile(input, bytes, { mode: 0o600, flag: "wx" });
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(file, [
        "-v", "error", "-protocol_whitelist", "file",
        "-select_streams", "a:0", "-show_entries", "packet=duration_time",
        "-of", "csv=p=0", "-i", input,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new Error("Analyse audio trop longue.");
        child.kill("SIGKILL");
      }, 15000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 2_000_000) {
          failure = new Error("Analyse audio trop volumineuse.");
          child.kill("SIGKILL");
        }
      });
      // Consume stderr without exposing file metadata or server paths.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); reject(new Error("Outil de vérification audio indisponible.")); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        if (code !== 0) { reject(new Error("Le fichier vocal n’a pas pu être analysé.")); return; }
        const duration = output.split(/\s+/).reduce((sum, line) => sum + (Number.parseFloat(line) || 0), 0);
        if (!Number.isFinite(duration) || duration <= 0) { reject(new Error("Durée audio introuvable.")); return; }
        resolve(duration);
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

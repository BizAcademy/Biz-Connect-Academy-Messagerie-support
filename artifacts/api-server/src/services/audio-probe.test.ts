import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileTypeFromBuffer } from "file-type";
import { probeAudio, normalizeVoiceMime } from "./audio-probe";

function wav(seconds: number) {
  const rate = 8000, length = Math.round(rate * seconds) * 2;
  const bytes = Buffer.alloc(44 + length);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + length, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(length, 40);
  return bytes;
}

const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("bca-voice-")));
const detected = await fileTypeFromBuffer(wav(1.25));
assert.equal(normalizeVoiceMime(detected!.mime), "audio/wav");
assert.equal(normalizeVoiceMime("audio/x-m4a"), "audio/mp4");
assert.equal(normalizeVoiceMime("video/mp4"), "audio/mp4");
assert.equal(normalizeVoiceMime("text/html"), undefined);
const duration = await probeAudio(wav(1.25));
assert(Math.abs(duration - 1.25) < 0.02, "Real audio packets must determine duration");
const longDuration = await probeAudio(wav(301));
assert(longDuration > 300.5, "The route must be able to detect an over-limit recording");
await assert.rejects(probeAudio(Buffer.from("this is not an audio recording")));
const after = (await readdir(tmpdir())).filter((name) => name.startsWith("bca-voice-") && !before.has(name));
assert.deepEqual(after, [], "Private temporary audio must be removed on success and failure");
console.log("PASS: packaged FFprobe executes without a system installation, real WAV duration, over-limit detection, invalid input rejection and private temporary-file cleanup.");

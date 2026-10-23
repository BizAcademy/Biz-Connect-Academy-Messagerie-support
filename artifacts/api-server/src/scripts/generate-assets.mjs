import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
const dir = new URL("../../../biz-connect/public/", import.meta.url);
await mkdir(dir, { recursive: true });
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0B1B3F"/><path d="M138 150h236v170H235l-70 54v-54h-27z" fill="#D4AF37"/><path d="M214 190h53c35 0 49 40 19 54 36 13 21 55-15 55h-57zm26 23v23h25c18 0 18-23 0-23zm0 45v20h29c18 0 18-20 0-20z" fill="#0B1B3F"/></svg>`);
for (const size of [192, 512]) await sharp(svg).resize(size).png().toFile(new URL(`icon-${size}.png`, dir).pathname);
await sharp(svg).resize(512).png().toFile(new URL("icon-maskable.png", dir).pathname);
await writeFile(new URL("brand.svg", dir), svg);
const sampleRate = 22050, count = Math.round(sampleRate * .32);
const wav = Buffer.alloc(44 + count * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++) {
  const t = i / sampleRate, envelope = Math.min(1, t * 100) * Math.exp(-t * 13);
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (t < .12 ? 880 : 1174) * t) * envelope * 7500), 44 + 2 * i);
}
await writeFile(new URL("notification.wav", dir), wav);

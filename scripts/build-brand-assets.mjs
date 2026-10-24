import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const sharp = require("sharp");
const output = path.join(root, "artifacts/biz-connect/public");
const blueSource = path.join(root, "attached_assets/photo_2026-01-12_16-14-30_1792821745570.jpg");
const colorSource = path.join(root, "attached_assets/photo_2026-09-21_14-38-52_1792821714660.jpg");

// Remove only the photos' empty margins and printing marks, not the logo.
await sharp(colorSource)
  .extract({ left: 75, top: 165, width: 830, height: 475 })
  .resize({ width: 830 })
  .png()
  .toFile(path.join(output, "logo-color.png"));

const { data } = await sharp(blueSource)
  .extract({ left: 30, top: 30, width: 1, height: 1 })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const background = { r: data[0], g: data[1], b: data[2] };
const blueCrop = await sharp(blueSource)
  .extract({ left: 58, top: 175, width: 825, height: 470 })
  .png().toBuffer();

async function square(size, contentFraction, filename) {
  const logo = await sharp(blueCrop)
    .resize({ width: Math.round(size * contentFraction) })
    .png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: logo, gravity: "centre" }])
    .png().toFile(path.join(output, filename));
}

await square(512, 0.84, "logo-blue.png");
await square(64, 0.88, "favicon.png");
await square(192, 0.84, "icon-192.png");
await square(512, 0.84, "icon-512.png");
await square(512, 0.70, "icon-maskable.png");
await square(180, 0.84, "apple-touch-icon.png");

// Android notification badges use a monochrome alpha mask, not a color icon.
const badge = await sharp(blueSource)
  .extract({ left: 60, top: 175, width: 350, height: 470 })
  .resize({ width: 64, height: 80, fit: "inside" })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const rgba = Buffer.alloc(badge.info.width * badge.info.height * 4);
for (let pixel = 0; pixel < rgba.length / 4; pixel++) {
  rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = 255;
  rgba[pixel * 4 + 3] = Math.max(0, Math.min(255,
    (Math.min(...badge.data.subarray(pixel * 3, pixel * 3 + 3)) - 80) * 2));
}
await sharp({ create: { width: 96, height: 96, channels: 4, background: "#00000000" } })
  .composite([{ input: rgba, raw: { width: badge.info.width, height: badge.info.height, channels: 4 }, gravity: "centre" }])
  .png().toFile(path.join(output, "notification-badge.png"));
console.log("Logos BCA, favicon, icônes d’installation et badge de notification générés.");

import assert from "node:assert/strict";
import { cropCanvas, drawOp, exportJpeg, flatten, normRect, textBox } from "../artifacts/biz-connect/src/components/chat/image-annotate";

// Unit checks only: recording canvas context, no browser, uploads or database.
function context() {
  const calls: Array<{ name: string; args: any[] }> = [];
  const ctx: any = { calls };
  for (const name of ["save", "restore", "beginPath", "moveTo", "lineTo", "rect", "ellipse",
    "quadraticCurveTo", "stroke", "strokeText", "fillText", "drawImage"]) {
    ctx[name] = (...args: any[]) => calls.push({ name, args });
  }
  ctx.measureText = (text: string) => ({ width: text.length * 10 });
  return ctx;
}

assert.deepEqual(normRect({ x: 70, y: 60 }, { x: 10, y: 20 }), { x: 10, y: 20, w: 60, h: 40 });
const rect = context();
drawOp(rect, { kind: "rect", color: "#00ff00", width: 4, a: { x: 70, y: 60 }, b: { x: 10, y: 20 } });
assert.deepEqual(rect.calls.find((c: any) => c.name === "rect")?.args, [10, 20, 60, 40]);
assert.equal(rect.strokeStyle, "#00ff00");
const circle = context();
drawOp(circle, { kind: "ellipse", color: "#ff0000", width: 5, a: { x: 70, y: 60 }, b: { x: 10, y: 20 } });
assert.deepEqual(circle.calls.find((c: any) => c.name === "ellipse")?.args.slice(0, 4), [40, 40, 30, 20]);
const arrow = context();
drawOp(arrow, { kind: "arrow", color: "#123456", width: 4, a: { x: 50, y: 90 }, b: { x: 10, y: 30 } });
const lines = arrow.calls.filter((c: any) => c.name === "lineTo");
assert.deepEqual(lines[0]?.args, [10, 30]);
assert.deepEqual(lines[1]?.args, [10, 30], "Arrowhead meets the target, including reverse drags");
assert.equal(lines.length, 3);
const pen = context();
const points = [{ x: 1, y: 1 }, { x: 5, y: 8 }, { x: 10, y: 4 }];
drawOp(pen, { kind: "pen", color: "#ff0000", width: 3, points });
assert(pen.calls.some((c: any) => c.name === "quadraticCurveTo"));
assert.equal(points.length, 3, "Rendering must not mutate undo history");
const text = context();
const label = { kind: "text", id: "label", color: "#ffffff", size: 20, x: 100, y: 100, text: "A\nB" } as const;
drawOp(text, label);
assert.deepEqual(text.calls.filter((c: any) => c.name === "fillText").map((c: any) => c.args), [["A", 100, 88], ["B", 100, 112]]);
assert.deepEqual(textBox(text, label), { x: 89, y: 70, w: 22, h: 60 });

const previousDocument = (globalThis as any).document;
const canvases: any[] = [];
(globalThis as any).document = {
  createElement: (tag: string) => {
    assert.equal(tag, "canvas");
    const ctx = context();
    const canvas: any = {
      width: 0, height: 0, ctx, qualities: [],
      getContext: () => ctx,
      toBlob: (done: (blob: Blob) => void, mime: string, quality: number) => {
        assert.equal(mime, "image/jpeg");
        canvas.qualities.push(quality);
        done(new Blob([new Uint8Array(quality > 0.6 ? 230 * 1024 : 100 * 1024)], { type: mime }));
      },
    };
    canvases.push(canvas);
    return canvas;
  },
};
try {
  const source = { width: 600, height: 400 } as HTMLCanvasElement;
  const cropped = cropCanvas(source, { x: 100, y: 50, w: 300, h: 200 }) as any;
  assert.equal(cropped.width, 300);
  assert.equal(cropped.height, 200);
  assert.deepEqual(cropped.ctx.calls[0].args, [source, 100, 50, 300, 200, 0, 0, 300, 200]);
  const composed = flatten({ base: source, ops: [label] }) as any;
  assert.equal(composed.width, 600);
  assert(composed.ctx.calls.some((c: any) => c.name === "drawImage"));
  assert.equal(composed.ctx.calls.filter((c: any) => c.name === "fillText").length, 2, "Export really embeds text");
  const large = { width: 1600, height: 800 } as HTMLCanvasElement;
  const exported = await exportJpeg(large);
  const resized = canvases.at(-1);
  assert.equal(resized.width, 1280);
  assert.equal(resized.height, 640);
  assert.equal(resized.qualities.length, 3, "Oversized JPEG is recompressed toward the data budget");
  assert(exported.size < 220 * 1024);
} finally {
  if (previousDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = previousDocument;
}
console.log("PASS: reversible shape geometry, arrow targets, freehand immutability, multiline text, crop pixels, flattened annotations, export size and data budget.");

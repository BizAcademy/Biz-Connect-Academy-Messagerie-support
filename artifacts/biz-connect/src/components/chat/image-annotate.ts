// Pure Canvas2D helpers for the pre-send image editor. All coordinates are in
// image pixels (the base canvas), never in CSS pixels.

export type Pt = { x: number; y: number };
export type Tool = "pen" | "arrow" | "ellipse" | "rect" | "text" | "crop";
export type Op =
  | { kind: "pen"; color: string; width: number; points: Pt[] }
  | { kind: "arrow" | "ellipse" | "rect"; color: string; width: number; a: Pt; b: Pt }
  | { kind: "text"; id: string; color: string; size: number; x: number; y: number; text: string };
export type Snapshot = { base: HTMLCanvasElement; ops: Op[] };
export type Rect = { x: number; y: number; w: number; h: number };

export const PALETTE = [
  { value: "#F4F1EA", label: "Blanc" },
  { value: "#14161C", label: "Noir" },
  { value: "#E5383B", label: "Rouge" },
  { value: "#FFB703", label: "Jaune" },
  { value: "#2BB673", label: "Vert" },
  { value: "#1E5EFF", label: "Bleu" },
  { value: "#C04BD8", label: "Violet" },
];
export const TEXT_SIZES = [
  { id: "s", label: "Petit", factor: 0.045 },
  { id: "m", label: "Moyen", factor: 0.07 },
  { id: "l", label: "Grand", factor: 0.105 },
] as const;

export const MAX_SIDE = 1280;

export async function blobToCanvas(blob: Blob, max = MAX_SIDE): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const fontFor = (size: number) => `700 ${size}px "Plus Jakarta Sans", "DM Sans", system-ui, sans-serif`;

export function textBox(ctx: CanvasRenderingContext2D, op: Extract<Op, { kind: "text" }>): Rect {
  ctx.font = fontFor(op.size);
  const lines = op.text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), op.size * 0.5);
  const lh = op.size * 1.2;
  const pad = op.size * 0.3;
  return { x: op.x - w / 2 - pad, y: op.y - (lh * lines.length) / 2 - pad, w: w + pad * 2, h: lh * lines.length + pad * 2 };
}

function contrastOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 150 ? "rgba(10,14,24,0.85)" : "rgba(255,255,255,0.9)";
}

export function drawOp(ctx: CanvasRenderingContext2D, op: Op) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (op.kind === "text") {
    ctx.font = fontFor(op.size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = op.text.split("\n");
    const lh = op.size * 1.2;
    const top = op.y - (lh * (lines.length - 1)) / 2;
    ctx.lineWidth = Math.max(2, op.size * 0.14);
    ctx.strokeStyle = contrastOf(op.color);
    ctx.fillStyle = op.color;
    lines.forEach((l, i) => {
      ctx.strokeText(l, op.x, top + i * lh);
      ctx.fillText(l, op.x, top + i * lh);
    });
  } else {
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = op.width * 0.6;
    ctx.beginPath();
    if (op.kind === "pen") {
      const p = op.points;
      ctx.moveTo(p[0]!.x, p[0]!.y);
      if (p.length === 1) ctx.lineTo(p[0]!.x + 0.01, p[0]!.y);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i]!.x + p[i + 1]!.x) / 2, my = (p[i]!.y + p[i + 1]!.y) / 2;
        ctx.quadraticCurveTo(p[i]!.x, p[i]!.y, mx, my);
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1]!.x, p[p.length - 1]!.y);
    } else if (op.kind === "rect") {
      ctx.rect(Math.min(op.a.x, op.b.x), Math.min(op.a.y, op.b.y), Math.abs(op.b.x - op.a.x), Math.abs(op.b.y - op.a.y));
    } else if (op.kind === "ellipse") {
      ctx.ellipse((op.a.x + op.b.x) / 2, (op.a.y + op.b.y) / 2, Math.abs(op.b.x - op.a.x) / 2 || 0.5, Math.abs(op.b.y - op.a.y) / 2 || 0.5, 0, 0, Math.PI * 2);
    } else {
      const ang = Math.atan2(op.b.y - op.a.y, op.b.x - op.a.x);
      const head = op.width * 4;
      ctx.moveTo(op.a.x, op.a.y);
      ctx.lineTo(op.b.x, op.b.y);
      ctx.moveTo(op.b.x - head * Math.cos(ang - 0.45), op.b.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(op.b.x, op.b.y);
      ctx.lineTo(op.b.x - head * Math.cos(ang + 0.45), op.b.y - head * Math.sin(ang + 0.45));
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function flatten(s: Snapshot): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = s.base.width;
  c.height = s.base.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(s.base, 0, 0);
  s.ops.forEach((o) => drawOp(ctx, o));
  return c;
}

export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  const w = Math.max(1, Math.min(src.width - x, Math.round(r.w)));
  const h = Math.max(1, Math.min(src.height - y, Math.round(r.h)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Export impossible"))), "image/jpeg", q));

/** Same budget as compressImage: max 1280 px, JPEG ~0.72 shrinking toward ~220 KB. */
export async function exportJpeg(src: HTMLCanvasElement, max = MAX_SIDE): Promise<Blob> {
  let c = src;
  const s = Math.min(1, max / Math.max(src.width, src.height));
  if (s < 1) {
    c = document.createElement("canvas");
    c.width = Math.round(src.width * s);
    c.height = Math.round(src.height * s);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }
  let q = 0.72;
  let blob = await toBlob(c, q);
  while (blob.size > 220 * 1024 && q > 0.46) {
    q -= 0.1;
    blob = await toBlob(c, q);
  }
  return blob;
}

export const normRect = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

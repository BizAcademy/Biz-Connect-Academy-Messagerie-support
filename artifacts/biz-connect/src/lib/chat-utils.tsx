import type { ReactNode } from "react";
import { format, isToday, isYesterday, differenceInCalendarDays } from "date-fns";
import { fr } from "date-fns/locale";

const LINK_RE = /((?:https?:\/\/|mailto:|tel:)[^\s<>"']+)/gi;
const SAFE = new Set(["http:", "https:", "mailto:", "tel:"]);

export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  let i = 0;
  while ((m = LINK_RE.exec(text))) {
    let href = m[0];
    const trail = href.match(/[.,;:!?)\]]+$/);
    if (trail) href = href.slice(0, -trail[0].length);
    let ok = false;
    try {
      ok = SAFE.has(new URL(href).protocol);
    } catch {
      ok = false;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    if (ok) {
      const external = href.startsWith("http");
      out.push(
        <a
          key={`l${i++}`}
          href={href}
          className="bubble-link"
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer nofollow" : undefined}
        >
          {href.replace(/^mailto:|^tel:/, "")}
        </a>,
      );
      last = m.index + href.length;
    } else {
      last = m.index;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const formatTime = (iso: string) => format(new Date(iso), "HH:mm");

export function formatListTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Hier";
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEE", { locale: fr });
  return format(d, "dd/MM/yy");
}

export function formatDayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Aujourd'hui";
  if (isYesterday(d)) return "Hier";
  return format(d, "EEEE d MMMM", { locale: fr });
}

export function formatLastSeen(iso: string | null) {
  if (!iso) return "hors ligne";
  const d = new Date(iso);
  if (isToday(d)) return `vu à ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `vu hier à ${format(d, "HH:mm")}`;
  return `vu le ${format(d, "d MMM", { locale: fr })}`;
}

export const formatDuration = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compression impossible"))), "image/jpeg", quality),
  );
}

export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvasBlob(canvas, quality);
}

export async function cropAvatar(file: File, size = 512): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvasBlob(canvas, 0.88);
}

export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

let interacted = false;
if (typeof window !== "undefined") {
  const mark = () => {
    interacted = true;
  };
  window.addEventListener("pointerdown", mark, { once: true });
  window.addEventListener("keydown", mark, { once: true });
}
let audio: HTMLAudioElement | null = null;
export function playNotificationSound() {
  if (!interacted || localStorage.getItem("bca-sound") === "off") return;
  try {
    audio ??= new Audio("/notification.wav");
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* browser refused */
  }
}

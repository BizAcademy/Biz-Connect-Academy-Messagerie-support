import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUpRight, Check, Circle, Crop, Loader2, PenLine, Redo2, RotateCcw, Square, Type, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PALETTE, TEXT_SIZES, blobToCanvas, clamp, cropCanvas, drawOp, exportJpeg, flatten, normRect, textBox,
  type Op, type Pt, type Rect, type Snapshot, type Tool,
} from "./image-annotate";

type TextEdit = { id: string; x: number; y: number; value: string; isNew: boolean };
type Gesture =
  | { type: "draw"; id: number; op: Op }
  | { type: "drag-text"; id: number; textId: string; dx: number; dy: number; moved: boolean; start: Pt }
  | { type: "crop"; id: number; mode: "new" | "move" | "nw" | "ne" | "sw" | "se"; start: Pt; orig: Rect };

const TOOLS: { id: Tool; label: string; icon: typeof PenLine }[] = [
  { id: "pen", label: "Crayon", icon: PenLine },
  { id: "arrow", label: "Flèche", icon: ArrowUpRight },
  { id: "ellipse", label: "Cercle", icon: Circle },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "text", label: "Texte", icon: Type },
  { id: "crop", label: "Rogner", icon: Crop },
];
const HINT: Record<Tool, string> = {
  pen: "Dessinez librement avec le doigt ou la souris.",
  arrow: "Glissez pour tracer une flèche.",
  ellipse: "Glissez pour tracer un cercle.",
  rect: "Glissez pour tracer un rectangle.",
  text: "Touchez l’image pour écrire. Glissez un texte pour le déplacer, touchez-le pour le modifier.",
  crop: "Tracez ou ajustez le cadre, puis appliquez.",
};

export function ImageEditor({ source, onCancel, onDone }: { source: Blob; onCancel: () => void; onDone: (blob: Blob | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadErr, setLoadErr] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(PALETTE[2]!.value);
  const [sizeId, setSizeId] = useState<(typeof TEXT_SIZES)[number]["id"]>("m");
  const [crop, setCrop] = useState<Rect | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [, bump] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const cur = history[idx];
  const dirty = idx > 0;

  useEffect(() => {
    let ok = true;
    setLoadErr(false);
    blobToCanvas(source).then(
      (base) => { if (ok) { setHistory([{ base, ops: [] }]); setIdx(0); } },
      () => { if (ok) setLoadErr(true); },
    );
    return () => { ok = false; };
  }, [source]);

  const commit = useCallback((next: Snapshot) => {
    setHistory((h) => [...h.slice(0, idx + 1), next]);
    setIdx((i) => i + 1);
  }, [idx]);

  const strokeW = cur ? Math.max(3, Math.round(Math.min(cur.base.width, cur.base.height) * 0.008)) : 4;
  const textSize = cur ? Math.round(Math.min(cur.base.width, cur.base.height) * TEXT_SIZES.find((s) => s.id === sizeId)!.factor) : 32;

  // ---------- render ----------
  const render = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !cur) return;
    if (c.width !== cur.base.width || c.height !== cur.base.height) { c.width = cur.base.width; c.height = cur.base.height; }
    const ctx = c.getContext("2d")!;
    ctx.drawImage(cur.base, 0, 0);
    const g = gesture.current;
    const hidden = textEdit?.id;
    const dragId = g?.type === "drag-text" ? g.textId : null;
    cur.ops.forEach((o) => {
      if (o.kind === "text" && o.id === hidden) return;
      if (o.kind === "text" && o.id === dragId && g?.type === "drag-text") drawOp(ctx, { ...o, x: g.start.x + g.dx, y: g.start.y + g.dy });
      else drawOp(ctx, o);
    });
    if (g?.type === "draw") drawOp(ctx, g.op);
    if (textEdit?.value.trim()) drawOp(ctx, { kind: "text", id: "_", color, size: textSize, x: textEdit.x, y: textEdit.y, text: textEdit.value });
    if (tool === "crop" && crop) {
      const u = c.width / (c.getBoundingClientRect().width || c.width);
      ctx.save();
      ctx.fillStyle = "rgba(8,12,24,0.6)";
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * u;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.lineWidth = 1 * u;
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(crop.x + (crop.w * i) / 3, crop.y); ctx.lineTo(crop.x + (crop.w * i) / 3, crop.y + crop.h);
        ctx.moveTo(crop.x, crop.y + (crop.h * i) / 3); ctx.lineTo(crop.x + crop.w, crop.y + (crop.h * i) / 3);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      const hs = 14 * u;
      for (const [hx, hy] of [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]] as const) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.restore();
    }
  }, [cur, crop, tool, textEdit, color, textSize]);
  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const on = () => render();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [render]);

  useEffect(() => {
    if (tool === "crop" && cur) {
      const m = Math.round(Math.min(cur.base.width, cur.base.height) * 0.06);
      setCrop({ x: m, y: m, w: cur.base.width - m * 2, h: cur.base.height - m * 2 });
    } else setCrop(null);
  }, [tool, cur]);

  // ---------- pointer mapping (canvas keeps aspect via max-w/max-h; rect == image box) ----------
  const toImg = (e: React.PointerEvent): Pt => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * c.width, 0, c.width), y: clamp(((e.clientY - r.top) / r.height) * c.height, 0, c.height) };
  };
  const unit = () => { const c = canvasRef.current!; return c.width / c.getBoundingClientRect().width; };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!cur || exporting || gesture.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = toImg(e);
    if (tool === "crop") {
      const r = crop ?? { x: p.x, y: p.y, w: 0, h: 0 };
      const tol = 24 * unit();
      const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] } as const;
      let mode: Extract<Gesture, { type: "crop" }>["mode"] = "new";
      for (const k of Object.keys(corners) as (keyof typeof corners)[]) {
        if (Math.hypot(p.x - corners[k][0], p.y - corners[k][1]) < tol) mode = k;
      }
      if (mode === "new" && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) mode = "move";
      gesture.current = { type: "crop", id: e.pointerId, mode, start: p, orig: r };
      return;
    }
    if (tool === "text") {
      if (textEdit) { finishText(); return; }
      const ctx = canvasRef.current!.getContext("2d")!;
      const hit = [...cur.ops].reverse().find((o): o is Extract<Op, { kind: "text" }> => {
        if (o.kind !== "text") return false;
        const b = textBox(ctx, o);
        return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      });
      if (hit) {
        dragOrigin.current = p;
        gesture.current = { type: "drag-text", id: e.pointerId, textId: hit.id, dx: 0, dy: 0, moved: false, start: { x: hit.x, y: hit.y } };
      }
      else { gesture.current = null; setTextEdit({ id: crypto.randomUUID(), x: p.x, y: p.y, value: "", isNew: true }); }
      return;
    }
    const op: Op = tool === "pen" ? { kind: "pen", color, width: strokeW, points: [p] } : { kind: tool, color, width: strokeW, a: p, b: p };
    gesture.current = { type: "draw", id: e.pointerId, op };
    render();
  };
  const dragOrigin = useRef<Pt | null>(null);
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !cur) return;
    const p = toImg(e);
    if (g.type === "draw") {
      if (g.op.kind === "pen") {
        const last = g.op.points[g.op.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) > unit() * 1.5) g.op.points.push(p);
      } else if (g.op.kind !== "text") g.op.b = p;
      render();
    } else if (g.type === "drag-text") {
      dragOrigin.current ??= p;
      g.dx = p.x - dragOrigin.current.x;
      g.dy = p.y - dragOrigin.current.y;
      if (Math.hypot(g.dx, g.dy) > 6 * unit()) g.moved = true;
      render();
    } else {
      const W = cur.base.width, H = cur.base.height, o = g.orig;
      const min = 24 * unit();
      let r: Rect;
      if (g.mode === "new") r = normRect(g.start, p);
      else if (g.mode === "move") r = { ...o, x: clamp(o.x + p.x - g.start.x, 0, W - o.w), y: clamp(o.y + p.y - g.start.y, 0, H - o.h) };
      else {
        const fixed = { nw: { x: o.x + o.w, y: o.y + o.h }, ne: { x: o.x, y: o.y + o.h }, sw: { x: o.x + o.w, y: o.y }, se: { x: o.x, y: o.y } }[g.mode];
        r = normRect(fixed, p);
      }
      if (r.w >= min && r.h >= min) setCrop(r);
    }
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !cur) return;
    gesture.current = null;
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (g.type === "draw") {
      const op = g.op;
      const tiny = op.kind !== "pen" && op.kind !== "text" && Math.hypot(op.b.x - op.a.x, op.b.y - op.a.y) < 6 * unit();
      if (!tiny) commit({ base: cur.base, ops: [...cur.ops, op] });
      else render();
    } else if (g.type === "drag-text") {
      const t = cur.ops.find((o) => o.kind === "text" && o.id === g.textId) as Extract<Op, { kind: "text" }> | undefined;
      if (!t) return;
      if (g.moved && origin) commit({ base: cur.base, ops: cur.ops.map((o) => (o === t ? { ...t, x: g.start.x + g.dx, y: g.start.y + g.dy } : o)) });
      else {
        setColor(t.color);
        const shortSide = Math.min(cur.base.width, cur.base.height);
        setSizeId(TEXT_SIZES.reduce((closest, size) =>
          Math.abs(shortSide * size.factor - t.size) < Math.abs(shortSide * closest.factor - t.size) ? size : closest,
        TEXT_SIZES[0]).id);
        setTextEdit({ id: t.id, x: t.x, y: t.y, value: t.text, isNew: false });
      }
    }
  };

  const finishText = () => {
    if (!textEdit || !cur) return;
    const value = textEdit.value.replace(/\s+$/, "");
    const exists = cur.ops.some((o) => o.kind === "text" && o.id === textEdit.id);
    const op: Op = { kind: "text", id: textEdit.id, color, size: textSize, x: textEdit.x, y: textEdit.y, text: value };
    if (!value.trim()) { if (exists) commit({ base: cur.base, ops: cur.ops.filter((o) => !(o.kind === "text" && o.id === textEdit.id)) }); }
    else if (exists) commit({ base: cur.base, ops: cur.ops.map((o) => (o.kind === "text" && o.id === textEdit.id ? op : o)) });
    else commit({ base: cur.base, ops: [...cur.ops, op] });
    setTextEdit(null);
  };

  const applyCrop = () => {
    if (!cur || !crop) return;
    commit({ base: cropCanvas(flatten(cur), crop), ops: [] });
    setTool("pen");
  };
  const undo = () => { if (idx > 0 && !exporting) { setTextEdit(null); setIdx(idx - 1); } };
  const redo = () => { if (idx < history.length - 1 && !exporting) { setTextEdit(null); setIdx(idx + 1); } };
  const reset = () => { if (dirty && !exporting) { setTextEdit(null); setHistory((h) => [h[0]!]); setIdx(0); } };

  const validate = async () => {
    if (!cur || exporting) return;
    if (textEdit) finishText();
    if (!dirty && !textEdit?.value.trim()) { onDone(null); return; }
    setExporting(true);
    setExportErr(null);
    try {
      // Flatten after a frame so a just-committed text is part of the snapshot.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const snap = latest.current;
      const blob = await exportJpeg(flatten(snap!));
      if (alive.current) onDone(blob);
    } catch {
      if (alive.current) { setExporting(false); setExportErr("Export impossible. Réessayez."); }
    }
  };
  const latest = useRef(cur);
  latest.current = cur;

  const requestClose = () => {
    if (exporting) return;
    if (textEdit) { setTextEdit(null); return; }
    if (dirty) setConfirmLeave(true);
    else onCancel();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (textEdit) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
  };

  const iconBtn = "grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/85 transition-[transform,background-color,opacity] duration-150 hover:bg-white/10 active:scale-90 disabled:pointer-events-none disabled:opacity-30";

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[#070B16]/95 animate-in fade-in-0 duration-200" />
        <DialogPrimitive.Content
          onKeyDown={onKey}
          onEscapeKeyDown={(e) => { e.preventDefault(); requestClose(); }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          aria-describedby="image-editor-hint"
          className="fixed inset-0 z-[60] flex flex-col bg-[radial-gradient(120%_80%_at_50%_0%,#13204A_0%,#070B16_65%)] text-white outline-none animate-in fade-in-0 zoom-in-[0.98] duration-200"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
          data-testid="dialog-image-editor"
        >
          {/* top bar */}
          <div className="flex items-center gap-1 px-2 py-2 sm:px-4">
            <button type="button" onClick={requestClose} disabled={exporting} className={iconBtn} aria-label="Annuler l’édition" data-testid="button-editor-cancel"><X className="h-5 w-5" /></button>
            <DialogPrimitive.Title className="ml-1 min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">Modifier l’image</DialogPrimitive.Title>
            <button type="button" onClick={undo} disabled={idx === 0 || exporting} className={iconBtn} aria-label="Annuler la dernière action" title="Annuler (Ctrl+Z)" data-testid="button-editor-undo"><Undo2 className="h-5 w-5" /></button>
            <button type="button" onClick={redo} disabled={idx >= history.length - 1 || exporting} className={iconBtn} aria-label="Rétablir" title="Rétablir (Ctrl+Y)" data-testid="button-editor-redo"><Redo2 className="h-5 w-5" /></button>
            <button type="button" onClick={reset} disabled={!dirty || exporting} className={iconBtn} aria-label="Tout réinitialiser" title="Tout réinitialiser" data-testid="button-editor-reset"><RotateCcw className="h-5 w-5" /></button>
          </div>

          {/* stage */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-2 sm:px-8">
            {loadErr ? (
              <div className="text-center text-sm text-white/70" role="alert" data-testid="status-editor-error">Image illisible.<button type="button" onClick={onCancel} className="mt-3 block w-full rounded-full bg-white/10 px-4 py-2" data-testid="button-editor-close-error">Fermer</button></div>
            ) : !cur ? (
              <div className="aspect-[4/3] w-full max-w-md animate-pulse rounded-2xl bg-white/5" data-testid="status-editor-loading" aria-label="Chargement de l’image" />
            ) : (
              <canvas
                ref={canvasRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onContextMenu={(e) => e.preventDefault()}
                className={cn("block h-auto max-h-full w-auto max-w-full touch-none select-none rounded-lg shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10", tool === "text" ? "cursor-text" : tool === "crop" ? "cursor-move" : "cursor-crosshair")}
                style={{ touchAction: "none" }}
                role="img"
                aria-label="Image en cours d’édition"
                data-testid="canvas-image-editor"
              />
            )}
            {exporting && <div className="absolute inset-0 grid place-items-center bg-[#070B16]/50" aria-live="polite" data-testid="status-editor-exporting"><span className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur"><Loader2 className="h-4 w-4 animate-spin" />Préparation…</span></div>}
          </div>

          {/* text input sheet */}
          {textEdit && (
            <div className="mx-auto flex w-full max-w-2xl items-end gap-2 px-3 pb-2" data-testid="panel-editor-text">
              <textarea
                autoFocus
                value={textEdit.value}
                rows={1}
                maxLength={200}
                onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                placeholder="Votre texte"
                aria-label="Texte à placer sur l’image"
                className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/40"
                style={{ color }}
                data-testid="input-editor-text"
              />
              <button type="button" onClick={finishText} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[#070B16] active:scale-90" aria-label="Placer le texte" data-testid="button-editor-text-done"><Check className="h-5 w-5" /></button>
            </div>
          )}

          {/* controls */}
          <div className="mx-auto w-full max-w-2xl space-y-2 px-3 pb-3">
            <p id="image-editor-hint" className="text-center text-xs text-white/55" data-testid="text-editor-hint">{exportErr ?? HINT[tool]}</p>

            {tool === "crop" ? (
              <div className="flex items-center justify-center gap-2">
                <button type="button" onClick={() => setTool("pen")} className="h-11 rounded-full bg-white/10 px-5 text-sm font-semibold active:scale-95" data-testid="button-crop-cancel">Annuler</button>
                <button type="button" onClick={applyCrop} disabled={!crop} className="h-11 rounded-full bg-white px-5 text-sm font-semibold text-[#070B16] active:scale-95 disabled:opacity-40" data-testid="button-crop-apply">Appliquer le rognage</button>
              </div>
            ) : (
              <div className="flex items-center justify-start gap-2 overflow-x-auto py-1 sm:justify-center" role="radiogroup" aria-label="Couleur">
                {PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={color === c.value}
                    aria-label={c.label}
                    onClick={() => setColor(c.value)}
                    className={cn("h-8 w-8 shrink-0 rounded-full ring-offset-2 ring-offset-[#0B1226] transition-transform duration-150 active:scale-90", color === c.value ? "scale-110 ring-2 ring-white" : "ring-1 ring-white/25")}
                    style={{ backgroundColor: c.value }}
                    data-testid={`button-color-${c.label.toLowerCase()}`}
                  />
                ))}
                {tool === "text" && (
                  <div className="ml-2 flex shrink-0 overflow-hidden rounded-full bg-white/10" role="radiogroup" aria-label="Taille du texte">
                    {TEXT_SIZES.map((s) => (
                      <button key={s.id} type="button" role="radio" aria-checked={sizeId === s.id} aria-label={`Texte ${s.label.toLowerCase()}`} onClick={() => setSizeId(s.id)} className={cn("h-8 w-9 font-bold", sizeId === s.id ? "bg-white text-[#070B16]" : "text-white/75")} style={{ fontSize: s.id === "s" ? 11 : s.id === "m" ? 14 : 17 }} data-testid={`button-text-size-${s.id}`}>A</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-0.5 rounded-full bg-white/[0.07] p-1 ring-1 ring-white/10 sm:justify-center sm:gap-1" role="radiogroup" aria-label="Outil">
                {TOOLS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={tool === id}
                    aria-label={label}
                    title={label}
                    disabled={exporting}
                    onClick={() => { if (textEdit) finishText(); setTool(id); }}
                    className={cn("grid h-10 w-10 place-items-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90", tool === id ? "bg-white text-[#070B16]" : "text-white/75 hover:bg-white/10")}
                    data-testid={`button-tool-${id}`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => void validate()} disabled={!cur || exporting || tool === "crop"} aria-label="Valider les modifications" className="flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-out px-4 text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#1E5EFF] transition active:scale-95 disabled:opacity-40" data-testid="button-editor-save">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}<span className="hidden min-[380px]:inline">Valider</span>
              </button>
            </div>
          </div>

          {confirmLeave && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-[#070B16]/70 p-6 animate-in fade-in-0" role="alertdialog" aria-label="Abandonner les modifications" data-testid="dialog-editor-discard">
              <div className="w-full max-w-xs rounded-2xl bg-[#111A33] p-5 text-center ring-1 ring-white/10">
                <p className="font-semibold">Abandonner les modifications ?</p>
                <p className="mt-1 text-sm text-white/60">L’image précédente est conservée.</p>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setConfirmLeave(false)} className="h-11 flex-1 rounded-full bg-white/10 text-sm font-semibold" data-testid="button-discard-keep">Continuer</button>
                  <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-full bg-red-500 text-sm font-semibold" data-testid="button-discard-confirm">Abandonner</button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

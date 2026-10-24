import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

const TRIGGER = 60;
const CAP = 100;
const CONTROLS = "audio,input,textarea,[data-message-menu],[data-testid='audio-seek'],[data-testid='audio-player'] button,[role='slider']";

export function useMessageGesture(onReply: () => void, onMenu: () => void) {
  const row = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ onReply, onMenu });
  callbacks.current = { onReply, onMenu };
  const suppressClick = useRef(false);
  const cancel = useRef<() => void>(() => {});

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let active: { id: number; kind: "touch" | "pointer"; x: number; y: number; dx: number; axis: "x" | "y" | null } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = (dx: number, animate = false) => {
      // Entrance animation stays on the wrapper, never on this draggable child.
      el.style.animation = "none";
      el.style.transition = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "transform 180ms ease-out" : "none";
      el.style.transform = `translate3d(${dx}px,0,0)`;
      if (hint.current) {
        hint.current.style.opacity = String(Math.min(1, Math.abs(dx) / TRIGGER));
        hint.current.style.left = dx > 0 ? "4px" : "auto";
        hint.current.style.right = dx > 0 ? "auto" : "4px";
      }
    };
    const finish = (commit: boolean) => {
      clearTimeout(timer);
      const g = active;
      active = null;
      if (!g) return;
      if (g.axis === "x") {
        suppressClick.current = true;
        paint(0, true);
        if (commit && Math.abs(g.dx) >= TRIGGER) {
          callbacks.current.onReply();
          navigator.vibrate?.(10);
        }
      }
      if (g.kind === "pointer" && el.hasPointerCapture(g.id)) el.releasePointerCapture(g.id);
    };
    cancel.current = () => finish(false);
    const start = (id: number, kind: "touch" | "pointer", x: number, y: number, target: EventTarget | null) => {
      finish(false);
      suppressClick.current = false;
      if (!(target instanceof Element) || target.closest(CONTROLS)) return;
      active = { id, kind, x, y, dx: 0, axis: null };
      timer = setTimeout(() => {
        suppressClick.current = true;
        finish(false);
        callbacks.current.onMenu();
        navigator.vibrate?.(8);
      }, 550);
    };
    const move = (x: number, y: number, event: Event) => {
      const g = active;
      if (!g) return;
      const dx = x - g.x;
      const dy = y - g.y;
      if (!g.axis) {
        if (Math.hypot(dx, dy) < 6) return;
        clearTimeout(timer);
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (g.axis === "y") { active = null; return; }
        if (g.kind === "pointer") {
          try { el.setPointerCapture(g.id); } catch { /* may already be released */ }
        }
      }
      if (event.cancelable) event.preventDefault();
      suppressClick.current = true;
      // Signed resistance works identically on sent and received messages.
      g.dx = Math.sign(dx) * (Math.abs(dx) > CAP ? CAP + (Math.abs(dx) - CAP) * 0.2 : Math.abs(dx));
      paint(g.dx);
    };
    // Touch events deliberately own touch gestures. Non-passive touchmove prevents
    // browser navigation/text selection without relying on pointer capture on iOS.
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { finish(false); return; }
      const t = e.changedTouches[0];
      if (t) start(t.identifier, "touch", t.clientX, t.clientY, e.target);
    };
    const touchMove = (e: TouchEvent) => {
      if (active?.kind !== "touch") return;
      const t = Array.from(e.changedTouches).find(t => t.identifier === active?.id);
      if (t) move(t.clientX, t.clientY, e);
    };
    const touchEnd = (e: TouchEvent) => {
      if (active?.kind === "touch" && Array.from(e.changedTouches).some(t => t.identifier === active?.id)) finish(true);
    };
    const touchCancel = () => finish(false);
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !e.isPrimary || e.button !== 0) return;
      start(e.pointerId, "pointer", e.clientX, e.clientY, e.target);
    };
    const pointerMove = (e: PointerEvent) => {
      if (active?.kind === "pointer" && active.id === e.pointerId) move(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent) => {
      if (active?.kind === "pointer" && active.id === e.pointerId) finish(true);
    };
    const pointerCancel = (e: PointerEvent) => {
      if (active?.kind === "pointer" && active.id === e.pointerId) finish(false);
    };
    const noDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", touchEnd);
    el.addEventListener("touchcancel", touchCancel);
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerCancel);
    el.addEventListener("lostpointercapture", pointerCancel);
    el.addEventListener("dragstart", noDrag);
    return () => {
      clearTimeout(timer);
      active = null;
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("touchcancel", touchCancel);
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerCancel);
      el.removeEventListener("lostpointercapture", pointerCancel);
      el.removeEventListener("dragstart", noDrag);
    };
  }, []);

  return {
    row, hint,
    onClickCapture: (e: ReactMouseEvent) => {
      if (suppressClick.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick.current = false;
      }
    },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      cancel.current();
      callbacks.current.onMenu();
    },
  };
}

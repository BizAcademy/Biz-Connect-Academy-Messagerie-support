import { useEffect, useRef } from "react";
import { getGetSummaryQueryKey, useGetSummary } from "@workspace/api-client-react";
import { playNotificationSound } from "@/lib/chat-utils";
import { useRealtime } from "@/components/realtime";
export { InstallBanner } from "./install-dialog";

/** Title + app badge + sound driven by the server summary. */
export function SummaryEffects() {
  const { status } = useRealtime();
  const { data } = useGetSummary({
    query: { queryKey: getGetSummaryQueryKey(), refetchInterval: status === "online" ? 60_000 : 15_000 },
  });
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    let cancelled = false;
    const original = link.href;
    if (data.unreadMessages > 0) {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.drawImage(image, 0, 0, 64, 64);
        ctx.fillStyle = "#D4AF37"; ctx.beginPath(); ctx.arc(46, 18, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0B1B3F"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(data.unreadMessages > 99 ? "99+" : String(data.unreadMessages), 46, 19);
        link.href = canvas.toDataURL("image/png");
      };
      image.src = "/icon-192.png";
    }
    return () => { cancelled = true; link.href = original; };
  }, [data?.unreadMessages]);
  useEffect(() => {
    if (!data) return;
    const n = data.unreadMessages;
    document.title = n > 0 ? `(${n}) BCA Messenger` : "BCA Messenger";
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
    if (prev.current !== null && n > prev.current) playNotificationSound();
    prev.current = n;
  }, [data]);
  useEffect(
    () => () => {
      document.title = "BCA Messenger";
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
      void nav.clearAppBadge?.().catch(() => undefined);
    },
    [],
  );
  return null;
}

export function ConnectionPill() {
  const { status } = useRealtime();
  const label = status === "online" ? "En direct" : status === "connecting" ? "Connexion…" : "Hors ligne";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground" data-testid="status-connection">
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (status === "online" ? "bg-[#16A34A]" : status === "connecting" ? "bg-gold animate-pulse" : "bg-destructive")
        }
      />
      {label}
    </span>
  );
}

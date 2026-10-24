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

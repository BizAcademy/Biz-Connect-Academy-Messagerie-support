import { useEffect, useRef, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { getGetSummaryQueryKey, useGetSummary } from "@workspace/api-client-react";
import { playNotificationSound } from "@/lib/chat-utils";
import { useRealtime } from "@/components/realtime";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
const bipListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    bipListeners.forEach((l) => l());
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
}

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
    document.title = n > 0 ? `(${n}) Biz Connect Academy` : "Biz Connect Academy";
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
    if (prev.current !== null && n > prev.current) playNotificationSound();
    prev.current = n;
  }, [data]);
  useEffect(
    () => () => {
      document.title = "Biz Connect Academy";
    },
    [],
  );
  return null;
}

export function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("bca-install-dismissed") === "1");
  useEffect(() => {
    const l = () => setCanPrompt(true);
    bipListeners.add(l);
    return () => {
      bipListeners.delete(l);
    };
  }, []);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  if (dismissed || standalone || (!canPrompt && !ios)) return null;
  const close = () => {
    localStorage.setItem("bca-install-dismissed", "1");
    setDismissed(true);
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    deferred = null;
    setCanPrompt(false);
    close();
  };
  return (
    <div className="flex items-center gap-3 border-b border-[#D4AF37]/30 bg-[#0B1B3F] px-4 py-2.5 text-white animate-in slide-in-from-top-2" data-testid="banner-install">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold font-display text-[#0B1B3F]">B</div>
      <div className="min-w-0 flex-1 text-xs leading-snug">
        {canPrompt ? (
          <>
            <span className="font-semibold">Installer l'application</span>
            <span className="text-white/60"> · accès direct, comme une vraie messagerie</span>
          </>
        ) : (
          <>
            Sur iPhone : touchez <Share className="mx-0.5 inline h-3.5 w-3.5 -translate-y-px" /> Partager, puis{" "}
            <span className="font-semibold">Sur l'écran d'accueil</span>.
          </>
        )}
      </div>
      {canPrompt && (
        <button onClick={install} className="inline-flex items-center gap-1 rounded-full bg-gold px-3 py-1 text-xs font-bold text-[#0B1B3F]" data-testid="button-install">
          <Download className="h-3.5 w-3.5" /> Installer
        </button>
      )}
      <button onClick={close} className="rounded-full p-1 text-white/60 hover:text-white" aria-label="Masquer" data-testid="button-dismiss-install">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
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

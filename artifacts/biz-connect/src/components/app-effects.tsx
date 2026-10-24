import { useEffect, useRef, useState } from "react";
import { Download, Share } from "lucide-react";
import { getGetSummaryQueryKey, useGetSummary } from "@workspace/api-client-react";
import { playNotificationSound } from "@/lib/chat-utils";
import { useRealtime } from "@/components/realtime";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isInstalled, isIos } from "@/lib/browser-push";

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
    const register = () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
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

export function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(() => isInstalled() || localStorage.getItem("bca-pwa-installed") === "1");
  useEffect(() => {
    const l = () => setCanPrompt(true);
    const done = () => { localStorage.setItem("bca-pwa-installed", "1"); setInstalled(true); deferred = null; };
    bipListeners.add(l);
    window.addEventListener("appinstalled", done);
    return () => {
      bipListeners.delete(l);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  const ios = isIos();
  if (dismissed || installed) return null;
  const close = () => {
    setDismissed(true);
  };
  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      setCanPrompt(false);
      close();
    } catch { deferred = null; setCanPrompt(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-sm rounded-3xl p-6" data-testid="banner-install">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Download className="h-6 w-6" /></div>
        <DialogHeader className="text-left">
          <DialogTitle>Installez BCA Messenger</DialogTitle>
          <DialogDescription>Retrouvez votre chat sur l’écran d’accueil et recevez les notifications de nouveaux messages après les avoir autorisées.</DialogDescription>
        </DialogHeader>
        {!canPrompt && <p className="text-sm leading-relaxed text-muted-foreground">
          {ios ? <><Share className="mr-1 inline h-4 w-4" />Sur iPhone ou iPad, ouvrez ce site dans Safari, touchez Partager puis « Sur l’écran d’accueil ».</>
            : <>Ouvrez le menu de votre navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil ». Si cette option n’est pas proposée, utilisez un navigateur compatible.</>}
        </p>}
        {canPrompt && <button onClick={() => void install()} className="rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground" data-testid="button-install">Installer l’application</button>}
        <button onClick={close} className="rounded-full border px-4 py-3 text-sm font-medium" data-testid="button-dismiss-install">Continuer dans le navigateur</button>
      </DialogContent>
    </Dialog>
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

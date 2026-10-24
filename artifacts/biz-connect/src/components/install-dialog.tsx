import { useEffect, useState } from "react";
import { Download, Loader2, Share } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isInstalled, isIos } from "@/lib/browser-push";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    listeners.forEach((listener) => listener());
  });
  if ("serviceWorker" in navigator) {
    const register = () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}

function installationGuide() {
  const ua = navigator.userAgent;
  if (isIos()) {
    return {
      title: "Installer sur iPhone ou iPad",
      steps: [
        "Ouvrez ce site dans Safari.",
        "Touchez Partager (le carré avec une flèche vers le haut).",
        "Choisissez « Sur l’écran d’accueil », puis « Ajouter ».",
        "Ouvrez BCA Messenger depuis son icône pour activer les notifications (iOS/iPadOS 16.4 ou plus récent).",
      ],
    };
  }
  if (/android/i.test(ua)) return {
    title: "Installer sur Android",
    steps: [
      "Ouvrez le menu de votre navigateur (⋮, ⋯ ou ☰).",
      "Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil », puis confirmez.",
      "Si cette option manque, ouvrez le site dans Chrome, Edge, Samsung Internet ou un navigateur Android compatible à jour.",
    ],
  };
  if (/firefox/i.test(ua)) return {
    title: "Utiliser sur Firefox",
    steps: [
      "Cherchez une option d’installation dans le menu Firefox si votre version la propose.",
      "L’installation comme application n’est pas proposée par toutes les versions de Firefox sur ordinateur.",
      "Vous pouvez ajouter ce site aux favoris ou créer un raccourci vers cette page sur votre bureau.",
      "Pour une installation en application, ouvrez le site dans Chrome, Edge ou Safari récent sur Mac. Le chat reste accessible dans Firefox.",
    ],
  };
  if (/safari/i.test(ua) && !/chrome|chromium|edg|opr/i.test(ua)) return {
    title: "Installer sur Mac",
    steps: [
      "Dans Safari récent, ouvrez le menu « Fichier » puis « Ajouter au Dock » si cette option est disponible.",
      "Confirmez l’ajout, puis ouvrez BCA Messenger depuis le Dock.",
      "Si l’option manque, continuez dans le navigateur ou utilisez Chrome ou Edge à jour.",
    ],
  };
  return {
    title: "Installer sur cet ordinateur",
    steps: [
      "Dans Chrome ou Edge, cherchez l’icône d’installation à droite de la barre d’adresse.",
      "Vous pouvez aussi ouvrir le menu du navigateur puis « Installer BCA Messenger » ou « Applications → Installer ce site en tant qu’application ».",
      "Si votre navigateur ne propose pas l’installation, utilisez un navigateur compatible à jour ou créez un raccourci vers cette page.",
    ],
  };
}

export function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(() => isInstalled() || localStorage.getItem("bca-pwa-installed") === "1");
  const [showGuide, setShowGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const available = () => setCanPrompt(true);
    const done = () => {
      localStorage.setItem("bca-pwa-installed", "1");
      setInstalled(true); deferred = null;
    };
    listeners.add(available);
    window.addEventListener("appinstalled", done);
    return () => {
      listeners.delete(available);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (dismissed || installed) return null;
  const close = () => setDismissed(true);
  const guide = installationGuide();
  const install = async () => {
    if (!deferred) { setShowGuide(true); return; }
    const event = deferred;
    deferred = null; setCanPrompt(false); setBusy(true); setNotice("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // prompt() is invoked immediately from the tap, not after awaited work.
      const choice = await Promise.race([
        (async () => { await event.prompt(); return event.userChoice; })(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 30000); }),
      ]);
      if (choice?.outcome === "accepted") close();
      else {
        setNotice(choice ? "Installation annulée. Vous pouvez réessayer depuis le menu du navigateur." : "Terminez l’installation dans la fenêtre du navigateur, ou suivez les étapes ci-dessous.");
        setShowGuide(true);
      }
    } catch {
      setNotice("L’installation directe n’est pas disponible. Suivez les étapes ci-dessous.");
      setShowGuide(true);
    } finally { clearTimeout(timer); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-3xl p-0" data-testid="banner-install">
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 sm:p-6">
          <BrandLogo className="h-14 w-14 rounded-2xl sm:h-16 sm:w-16" />
          <DialogHeader className="text-left">
            <DialogTitle className="pr-5">Installez BCA Messenger</DialogTitle>
            <DialogDescription>Retrouvez votre chat sur l’écran d’accueil et recevez les notifications de nouveaux messages après les avoir autorisées.</DialogDescription>
          </DialogHeader>
          {!canPrompt && !showGuide && <p className="text-xs leading-relaxed text-muted-foreground">Touchez « Installer » pour afficher les étapes adaptées à votre appareil.</p>}
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          {showGuide && (
            <section className="rounded-2xl bg-muted/60 p-4 text-sm" data-testid="install-instructions">
              <h3 className="flex items-center gap-2 font-semibold">{isIos() && <Share className="h-4 w-4 shrink-0" />}{guide.title}</h3>
              <ol className="mt-3 list-decimal space-y-2 break-words pl-5 text-muted-foreground">
                {guide.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </section>
          )}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t bg-background p-4 sm:px-6">
          <button type="button" onClick={() => void install()} disabled={busy} aria-busy={busy} className="inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-full bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-install">
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}Installer
          </button>
          <button type="button" onClick={close} className="min-h-12 min-w-0 rounded-full border px-3 py-3 text-sm font-semibold" data-testid="button-dismiss-install">Plus tard</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

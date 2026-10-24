import { useEffect, useState } from "react";
import { Bell, HelpCircle, Loader2, X } from "lucide-react";
import { type Account } from "@workspace/api-client-react";
import { usePushActivation, usePushConfiguration } from "@/hooks/use-push-activation";
import { DeviceGuide, type GuideTopic } from "@/components/device-guide";

/** Permission is requested only from a tap; granted subscriptions rebind after reopening a session. */
export function NotificationPrompt({ account }: { account: Account }) {
  const [dismissed, setDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const config = usePushConfiguration();
  const { ready, busy, error, permission, supported, needsInstall, enable, reconnectOnce } =
    usePushActivation(account, config.data?.enabled ? config.data.publicKey : null);
  useEffect(() => { setDismissed(false); setShowHelp(false); }, [account.id, account.role]);
  useEffect(() => {
    reconnectOnce();
  }, [reconnectOnce]);
  if (ready || dismissed) return null;
  const serverOk = !!config.data?.enabled;
  const canRequest = !needsInstall && supported && permission !== "denied" && serverOk;
  const topic: GuideTopic | null = needsInstall ? "notify-ios"
    : !supported ? "notify-unsupported"
    : permission === "denied" ? "notify-denied"
    : null;
  const message = needsInstall
    ? "Sur iPhone ou iPad (iOS 16.4 ou plus récent), les notifications ne fonctionnent qu’une fois BCA Messenger ajouté à l’écran d’accueil et ouvert depuis son icône."
    : !supported ? "Ce navigateur ne gère pas les notifications. Ouvrez BCA Messenger dans un navigateur compatible ou depuis l’écran d’accueil."
    : permission === "denied" ? "Les notifications sont bloquées. Seuls vous pouvez les réautoriser dans les réglages, le site ne peut pas le faire à votre place."
    : config.isError ? "Le service de notifications est momentanément inaccessible."
    : config.data && !serverOk ? "Le serveur de notifications n’est pas encore disponible. Contactez le support."
    : "Activez les notifications pour être averti des nouveaux messages, même lorsque le chat n’est pas ouvert.";
  const helpLabel = needsInstall ? "Voir comment installer" : permission === "denied" ? "Voir comment débloquer" : "Voir comment faire";
  return (
    <section className="shrink-0 border-b border-primary/20 bg-card px-4 py-3 text-sm" aria-label="Notifications sur téléphone" data-testid="notice-notifications">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Recevoir les notifications</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
          {error && <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {canRequest && (
              <button type="button" onClick={() => void enable(true)} disabled={busy} aria-busy={busy} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-enable-push">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Activation…" : error ? "Réessayer" : "Activer les notifications"}
              </button>
            )}
            {topic && (
              <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${canRequest ? "border" : "bg-primary text-primary-foreground"}`} data-testid="button-push-help">
                <HelpCircle className="h-3.5 w-3.5" />{showHelp ? "Masquer l’aide" : helpLabel}
              </button>
            )}
            {permission === "denied" && supported && !needsInstall && serverOk && (
              <button type="button" onClick={() => void enable(true)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-60" data-testid="button-retry-push">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}J’ai réautorisé, réessayer
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Plus tard pour les notifications" className="rounded-full p-1 text-muted-foreground" data-testid="button-dismiss-push"><X className="h-4 w-4" /></button>
      </div>
      {topic && showHelp && <div className="mt-3 max-h-[60dvh] overflow-y-auto"><DeviceGuide topic={topic} /></div>}
    </section>
  );
}

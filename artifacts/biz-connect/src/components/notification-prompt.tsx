import { useEffect, useState } from "react";
import { Bell, Loader2, X } from "lucide-react";
import { type Account } from "@workspace/api-client-react";
import { usePushActivation, usePushConfiguration } from "@/hooks/use-push-activation";

/** Permission is requested only from a tap; granted subscriptions rebind after reopening a session. */
export function NotificationPrompt({ account }: { account: Account }) {
  const [dismissed, setDismissed] = useState(false);
  const config = usePushConfiguration();
  const { ready, busy, error, permission, supported, needsInstall, enable, reconnectOnce } =
    usePushActivation(account, config.data?.enabled ? config.data.publicKey : null);
  useEffect(() => setDismissed(false), [account.id, account.role]);
  useEffect(() => {
    reconnectOnce();
  }, [reconnectOnce]);
  if (ready || dismissed) return null;
  const message = needsInstall
    ? "Sur iPhone ou iPad, ajoutez BCA Messenger à l’écran d’accueil depuis Safari, ouvrez l’application installée puis activez les notifications."
    : !supported ? "Pour les notifications sur téléphone, ouvrez BCA Messenger dans un navigateur compatible ou depuis l’écran d’accueil."
    : permission === "denied" ? "Les notifications sont bloquées. Autorisez-les dans les réglages du navigateur ou de votre téléphone."
    : config.isError ? "Le service de notifications est momentanément inaccessible."
    : config.data && !config.data.enabled ? "Le serveur de notifications n’est pas encore disponible. Contactez le support."
    : "Activez les notifications pour être averti des nouveaux messages, même lorsque le chat n’est pas ouvert.";
  return (
    <section className="flex shrink-0 items-start gap-3 border-b border-primary/20 bg-card px-4 py-3 text-sm" aria-label="Notifications sur téléphone" data-testid="notice-notifications">
      <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Recevoir les notifications</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
        {error && <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p>}
        {!needsInstall && supported && permission !== "denied" && config.data?.enabled && (
          <button onClick={() => void enable(true)} disabled={busy} aria-busy={busy} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-enable-push">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Activation…" : error ? "Réessayer" : "Activer les notifications"}
          </button>
        )}
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Plus tard pour les notifications" className="rounded-full p-1 text-muted-foreground" data-testid="button-dismiss-push"><X className="h-4 w-4" /></button>
    </section>
  );
}

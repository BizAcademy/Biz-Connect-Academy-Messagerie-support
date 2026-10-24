import { useCallback, useEffect, useRef, useState } from "react";
import { getGetPushConfigQueryKey, getPushConfig, subscribePush, useGetPushConfig, type Account } from "@workspace/api-client-react";
import { activateBrowserPush, isInstalled, isIos, PushActivationError, withPushDeadline } from "@/lib/browser-push";
import { errorMessage } from "@/lib/api-fetch";

export function usePushConfiguration(enabled = true) {
  return useGetPushConfig({ query: {
    queryKey: getGetPushConfigQueryKey(), staleTime: 300000, enabled, retry: false,
    queryFn: ({ signal }) => withPushDeadline((current) => getPushConfig({ signal: current }), 15000, signal),
  } });
}

/** One active attempt, no automatic retry loop, and no late result after logout. */
export function usePushActivation(account: Account, publicKey?: string | null) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const autoAttempt = useRef("");
  const scope = `${account.role}:${account.id}`;
  const supported = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
  const needsInstall = isIos() && !isInstalled();

  useEffect(() => {
    mounted.current = true;
    setReady(false); setError("");
    const enabled = (event: Event) => {
      if ((event as CustomEvent<string>).detail === scope) {
        setReady(true); setError(""); setPermission("granted");
      }
    };
    const focus = () => {
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
    };
    window.addEventListener("bca-push-enabled", enabled);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      autoAttempt.current = "";
      controller.current?.abort();
      window.removeEventListener("bca-push-enabled", enabled);
      window.removeEventListener("focus", focus);
    };
  }, [scope]);

  const enable = useCallback(async (requestPermission: boolean): Promise<boolean> => {
    if (!publicKey || !supported || needsInstall || (controller.current && !controller.current.signal.aborted)) return false;
    const current = new AbortController();
    controller.current = current;
    autoAttempt.current = `${scope}:${publicKey}`;
    setBusy(true); setError("");
    try {
      const enabled = await activateBrowserPush(publicKey, (data, signal) => subscribePush(data, { signal }), {
        requestPermission, signal: current.signal,
        onPermission: (value) => { if (mounted.current && controller.current === current) setPermission(value); },
      });
      if (enabled && mounted.current && controller.current === current && !current.signal.aborted) {
        setReady(true);
        window.dispatchEvent(new CustomEvent("bca-push-enabled", { detail: scope }));
        return true;
      }
    } catch (exception) {
      if (mounted.current && controller.current === current && !current.signal.aborted) {
        const name = (exception as Error)?.name;
        setError(exception instanceof PushActivationError ? exception.message
          : name === "NotAllowedError" ? "Autorisez les notifications dans les réglages du navigateur ou de l’appareil, puis réessayez."
          : name === "NotSupportedError" ? "Ce navigateur ne permet pas les notifications Web Push sur cet appareil."
          : name === "SecurityError" ? "Les notifications nécessitent un accès sécurisé HTTPS."
          : errorMessage(exception, "Impossible d’activer les notifications. Vérifiez votre connexion, puis réessayez."));
        if (typeof Notification !== "undefined") setPermission(Notification.permission);
      }
    } finally {
      if (controller.current === current) {
        controller.current = null;
        if (mounted.current) setBusy(false);
      }
    }
    return false;
  }, [scope, publicKey, supported, needsInstall]);

  const reconnectOnce = useCallback(() => {
    const attempt = `${scope}:${publicKey}`;
    if (publicKey && supported && !needsInstall && Notification.permission === "granted" && autoAttempt.current !== attempt) {
      autoAttempt.current = attempt;
      void enable(false);
    }
  }, [scope, publicKey, supported, needsInstall, enable]);

  return { busy, ready, error, permission, supported, needsInstall, enable, reconnectOnce };
}

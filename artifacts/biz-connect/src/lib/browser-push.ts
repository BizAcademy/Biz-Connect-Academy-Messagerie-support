export class PushActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushActivationError";
  }
}

export type BrowserPushInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Bound the entire operation, including permission, worker and HTTP registration. */
export async function withPushDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => {
          controller.abort();
          reject(new DOMException("Activation annulée.", "AbortError"));
        };
        if (parent?.aborted) return abort();
        parent?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          // Reject with the useful error before aborting a pending HTTP request.
          reject(new PushActivationError("L’activation a pris trop de temps. Fermez la demande du navigateur si elle est encore ouverte, puis réessayez."));
          controller.abort();
        }, timeoutMs);
      }),
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return run(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) parent?.removeEventListener("abort", abort);
  }
}

async function subscription(publicKey: string, signal: AbortSignal): Promise<BrowserPushInput> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new PushActivationError("Ce navigateur ne prend pas en charge les notifications Web Push.");
  }
  signal.throwIfAborted();
  await navigator.serviceWorker.register(`${import.meta.env?.BASE_URL || "/"}sw.js`);
  signal.throwIfAborted();
  const reg = await navigator.serviceWorker.ready;
  signal.throwIfAborted();
  const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "="));
  const key = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  signal.throwIfAborted();
  // A server-key change must not keep an unusable subscription forever.
  const previous = sub?.options?.applicationServerKey;
  if (previous && (previous.byteLength !== key.length || new Uint8Array(previous).some((byte, i) => byte !== key[i]))) {
    await sub!.unsubscribe();
    signal.throwIfAborted();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  signal.throwIfAborted();
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new PushActivationError("Le navigateur a renvoyé un abonnement incomplet. Réessayez.");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export function browserPushSubscription(publicKey: string, signal?: AbortSignal) {
  return withPushDeadline((current) => subscription(publicKey, current), 20000, signal);
}

export async function activateBrowserPush(
  publicKey: string,
  save: (data: BrowserPushInput, signal: AbortSignal) => Promise<unknown>,
  options: {
    requestPermission: boolean;
    signal?: AbortSignal;
    onPermission?: (permission: NotificationPermission) => void;
    timeoutMs?: number;
  },
) {
  if (typeof Notification === "undefined") throw new PushActivationError("Les notifications ne sont pas disponibles dans ce navigateur.");
  options.signal?.throwIfAborted();
  // Invoke permission synchronously from the click, before any awaited work.
  const permission = options.requestPermission && Notification.permission !== "granted"
    ? Notification.requestPermission()
    : Promise.resolve(Notification.permission);
  return withPushDeadline(async (signal) => {
    const result = await permission;
    signal.throwIfAborted();
    options.onPermission?.(result);
    if (result !== "granted") return false;
    const data = await subscription(publicKey, signal);
    signal.throwIfAborted();
    await save(data, signal);
    signal.throwIfAborted();
    return true;
  }, options.timeoutMs ?? 30000, options.signal);
}

export const isInstalled = () => !!(window.matchMedia?.("(display-mode: standalone)").matches
  || (navigator as Navigator & { standalone?: boolean }).standalone);
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

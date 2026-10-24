export async function browserPushSubscription(publicKey: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Notifications non prises en charge par ce navigateur.");
  const start = async () => {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    const reg = await navigator.serviceWorker.ready;
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "="));
    const key = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: key,
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Abonnement incomplet. Réessayez.");
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      start(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Le service de notifications ne répond pas. Réessayez.")), 20000); }),
    ]);
  } finally { clearTimeout(timer); }
}
export const isInstalled = () => !!(window.matchMedia?.("(display-mode: standalone)").matches
  || (navigator as Navigator & { standalone?: boolean }).standalone);
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

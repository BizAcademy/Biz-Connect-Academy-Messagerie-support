/* Only public app assets are cached. API responses and private media never are. */
const CACHE = "biz-connect-shell-v3-official-logos";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("biz-connect-shell-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) { const clone = response.clone(); caches.open(CACHE).then((c) => c.put("/", clone)); }
      return response;
    }).catch(async () => await caches.match("/") || Response.error()));
  } else if (/^\/assets\//.test(url.pathname) || /^\/icon-/.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) { const clone = response.clone(); caches.open(CACHE).then((c) => c.put(event.request, clone)); }
      return response;
    })));
  }
});
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { data = {}; }
    let icon = "/icon-192.png";
    if (typeof data.senderAvatarUrl === "string" && /^\/api\/files\/[a-f0-9-]{36}$/i.test(data.senderAvatarUrl)) {
      try {
        let avatar = await fetch(data.senderAvatarUrl, { credentials: "include" });
        if (avatar.status === 401) {
          await fetch("/api/auth/session", { credentials: "include" });
          avatar = await fetch(data.senderAvatarUrl, { credentials: "include" });
        }
        if (avatar.ok && (avatar.headers.get("Content-Type") || "").startsWith("image/")) {
          const bytes = new Uint8Array(await avatar.arrayBuffer());
          if (bytes.length <= 256 * 1024) {
            let binary = "";
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            icon = `data:${avatar.headers.get("Content-Type")};base64,${btoa(binary)}`;
          }
        }
      } catch { /* Offline or unavailable avatar: retain application icon. */ }
    }
    await self.registration.showNotification(data.title || "BCA Messenger", {
      body: data.body || "Vous avez reçu un nouveau message.",
      icon,
      badge: "/notification-badge.png",
      tag: data.tag || "biz-connect-message", renotify: true,
      vibrate: [180, 80, 180], data: { conversationId: data.conversationId },
    });
    // Background badge is best effort; foreground rehydrates the exact count.
    if ("setAppBadge" in self.navigator) {
      try {
        let response = await fetch("/api/conversations/summary", { credentials: "include" });
        if (response.status === 401) {
          await fetch("/api/auth/session", { credentials: "include" });
          response = await fetch("/api/conversations/summary", { credentials: "include" });
        }
        if (response.ok) {
          const summary = await response.json();
          await self.navigator.setAppBadge(summary.unreadMessages ?? summary.unread);
        }
      } catch { /* Offline: retain existing badge. */ }
    }
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const id = event.notification.data?.conversationId;
    const url = new URL("/", self.location.origin);
    if (id) url.searchParams.set("conversation", id);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((w) => new URL(w.url).origin === url.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ conversationId: id });
    } else await self.clients.openWindow(url.href);
  })());
});

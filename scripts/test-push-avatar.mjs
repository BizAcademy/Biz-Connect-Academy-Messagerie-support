import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const events = {};
const requests = [];
let shown, badge, avatarAttempts = 0;
const avatar = "/api/files/12345678-1234-1234-1234-123456789012";
const self = {
  addEventListener(name, handler) { events[name] = handler; },
  navigator: { async setAppBadge(n) { badge = n; } },
  registration: { async showNotification(title, options) { shown = { title, ...options }; } },
};
const context = vm.createContext({
  self, Uint8Array, btoa, URL, Response, console,
  fetch: async (url) => {
    requests.push(url);
    if (url === avatar) {
      if (!avatarAttempts++) return new Response("", { status: 401 });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } });
    }
    if (url === "/api/conversations/summary") return Response.json({ unreadMessages: 12 });
    return Response.json({});
  },
});
vm.runInContext(await fs.readFile("artifacts/biz-connect/public/sw.js", "utf8"), context);
let done;
events.push({ data: { json: () => ({ title: "Expéditeur", body: "Bonjour", senderAvatarUrl: avatar, conversationId: "fixture" }) }, waitUntil(p) { done = p; } });
await done;
assert.equal(shown.title, "Expéditeur"); assert.equal(shown.body, "Bonjour");
assert.equal(shown.icon, "data:image/webp;base64,AQID");
assert.equal(badge, 12); assert.deepEqual(requests.slice(0, 3), [avatar, "/api/auth/session", avatar]);
events.push({ data: { json: () => ({ senderAvatarUrl: "https://untrusted.invalid/private" }) }, waitUntil(p) { done = p; } });
await done;
assert.equal(shown.icon, "/icon-192.png");
assert(!requests.some((url) => url.includes("untrusted")));
console.log("PASS: push sender avatar + content, expired-session renewal, unread badge, safe fallback and external icon rejected.");

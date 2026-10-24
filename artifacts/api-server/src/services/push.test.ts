import assert from "node:assert/strict";
process.env.DATABASE_URL = "mysql://fixture:fixture@127.0.0.1:1/test";
process.env.SESSION_SECRET = "local-unit-test-secret-at-least-32-characters";
process.env.NODE_ENV = "test";
process.env.VAPID_SUBJECT = "https://fixture.invalid";
const webPush = (await import("web-push")).default;
const { PushSubscription, SessionRecord, sequelize } = await import("@workspace/db");
const { sendMessagePush, validPushEndpoint } = await import("./push");
const original = { subscriptions: PushSubscription.findAll, sessions: SessionRecord.findAll, send: webPush.sendNotification };
let deleted = false;
let sent = 0;
const rows = [
  { sessionId: "active", accountId: "member", role: "member", endpoint: "https://fcm.googleapis.com/fake", p256dh: "fixture", auth: "fixture" },
  { sessionId: "active", accountId: "member", role: "member", endpoint: "https://wns2-unit.notify.windows.com/w/?token=fixture", p256dh: "fixture", auth: "fixture" },
  { sessionId: "active", accountId: "member", role: "member", endpoint: "https://wns2-unit.notify.windows.com.attacker.invalid/push" },
  { sessionId: "revoked", accountId: "member", role: "member", endpoint: "https://fcm.googleapis.com/old" },
  { sessionId: "active", accountId: "another-member", role: "member", endpoint: "https://fcm.googleapis.com/wrong-owner" },
];
try {
  PushSubscription.findAll = (async (options: any) => {
    assert.equal(options.where.accountId, "member");
    return rows.map((data) => ({ get: (key?: keyof typeof data) => key ? data[key] : data, destroy: async () => { deleted = true; } }));
  }) as typeof PushSubscription.findAll;
  SessionRecord.findAll = (async () => [{ get: (key: keyof typeof rows[0]) => ({ id: "active", accountId: "member", role: "member" } as any)[key] }]) as typeof SessionRecord.findAll;
  webPush.sendNotification = (async (_subscription: any, body: string, options: any) => {
    sent++;
    const data = JSON.parse(body);
    assert.equal(data.conversationId, "conversation");
    assert.equal(data.body, "Bonjour, votre demande est traitée.");
    assert.equal(data.title, "Support BCA");
    assert.equal(options.urgency, "high");
    assert.equal(options.TTL, 86400);
    return {};
  }) as typeof webPush.sendNotification;
  for (const endpoint of [
    "https://fcm.googleapis.com/fake",
    "https://updates.push.services.mozilla.com/wpush/v2/fixture",
    "https://web.push.apple.com/fixture",
    "https://wns2-am3p.notify.windows.com/w/?token=fixture",
    "https://sg2p.notify.windows.com/w/?token=fixture",
    "https://WNS2-AM3P.notify.windows.com/w/?token=fixture",
  ]) assert(validPushEndpoint(endpoint), `Supported provider rejected: ${endpoint}`);
  for (const endpoint of [
    "https://attacker.invalid/push",
    "https://127.0.0.1/push",
    "https://localhost/push",
    "http://wns2-am3p.notify.windows.com/w/",
    "https://wns2-am3p.notify.windows.com:8443/w/",
    "https://username:password@wns2-am3p.notify.windows.com/w/",
    "https://wns2-am3p.notify.windows.com.attacker.invalid/w/",
    "https://evilnotify.windows.com/w/",
    "https://notify.windows.com/w/",
    "https://nested.wns2-am3p.notify.windows.com/w/",
    "https://fcm.googleapis.com.attacker.invalid/w/",
    "https://web.push.apple.com@attacker.invalid/w/",
    "https://wns2-am3p.notify.windows.com/w/#fragment",
    "not-a-url",
  ]) assert(!validPushEndpoint(endpoint), `Unsafe endpoint accepted: ${endpoint}`);
  await sendMessagePush({ id: "support", role: "admin" }, "member", { conversationId: "conversation", senderName: "Support BCA", type: "text", content: "Bonjour, votre demande est traitée." });
  assert.equal(sent, 2, "Only active, recipient-owned subscriptions on trusted FCM/WNS providers receive the push");
  webPush.sendNotification = (async () => { throw { statusCode: 410 }; }) as typeof webPush.sendNotification;
  await sendMessagePush({ id: "support", role: "admin" }, "member", { conversationId: "conversation" });
  assert(deleted, "An expired push endpoint is removed");
  console.log("PASS: Google/Apple/Mozilla/Microsoft endpoints, spoofed/internal endpoints rejected, recipient/session ownership, revoked sessions excluded, expired endpoints cleaned (delivery simulated).");
} finally {
  PushSubscription.findAll = original.subscriptions;
  SessionRecord.findAll = original.sessions;
  webPush.sendNotification = original.send;
  await sequelize.close();
}

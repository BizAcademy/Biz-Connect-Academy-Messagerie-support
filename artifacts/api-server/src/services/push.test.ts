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
    assert.equal(data.body, "Vous avez reçu un nouveau message.");
    assert.equal(options.urgency, "high");
    assert.equal(options.TTL, 86400);
    return {};
  }) as typeof webPush.sendNotification;
  assert(!validPushEndpoint("https://attacker.invalid/push"));
  await sendMessagePush({ id: "support", role: "admin" }, "member", { conversationId: "conversation" });
  assert.equal(sent, 1, "Only the active subscription owned by the recipient receives the push");
  webPush.sendNotification = (async () => { throw { statusCode: 410 }; }) as typeof webPush.sendNotification;
  await sendMessagePush({ id: "support", role: "admin" }, "member", { conversationId: "conversation" });
  assert(deleted, "An expired push endpoint is removed");
  console.log("PASS: push recipient/session ownership, revoked sessions excluded, real-time priority, expired endpoints cleaned (delivery simulated).");
} finally {
  PushSubscription.findAll = original.subscriptions;
  SessionRecord.findAll = original.sessions;
  webPush.sendNotification = original.send;
  await sequelize.close();
}

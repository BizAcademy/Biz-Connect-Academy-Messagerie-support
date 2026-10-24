import webPush from "web-push";
import { createECDH, createHash } from "node:crypto";
import { PushSubscription, SessionRecord } from "@workspace/db";
import { Op } from "sequelize";
import { jwtKey, appOrigin, production } from "../lib/config";
import type { Identity } from "./accounts";
import { logger } from "../lib/logger";

// Domain-separated key material; explicit VAPID keypair can be set instead.
const ecdh = createECDH("prime256v1");
ecdh.setPrivateKey(createHash("sha256").update(jwtKey).update(":web-push:v1").digest());
const publicKey = process.env.VAPID_PUBLIC_KEY || ecdh.getPublicKey().toString("base64url");
const privateKey = process.env.VAPID_PRIVATE_KEY || ecdh.getPrivateKey().toString("base64url");
const subject = process.env.VAPID_SUBJECT || (!production && process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : appOrigin);
export const pushEnabled = !!subject;
export const pushConfig = { enabled: pushEnabled, publicKey: pushEnabled ? publicKey : null };
if (subject) webPush.setVapidDetails(subject, publicKey, privateKey);
let activePushes = 0;
const pendingPushes: Array<() => void> = [];
async function withPushSlot(run: () => Promise<unknown>) {
  if (activePushes < 8) activePushes++;
  else {
    if (pendingPushes.length >= 1000) throw new Error("Push capacity reached");
    await new Promise<void>((resolve) => pendingPushes.push(resolve));
  }
  try { return await run(); }
  finally { const next = pendingPushes.shift(); if (next) next(); else activePushes--; }
}

export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    // Edge on Windows uses regional WNS hosts (e.g. wns2-am3p.notify.windows.com),
    // while Edge on Android generally uses Google's FCM. Keep the suffix bounded
    // to Microsoft's domain: accepting arbitrary HTTPS endpoints enables SSRF.
    const trustedHost = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname)
      || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.notify\.windows\.com$/.test(url.hostname);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !url.hash && trustedHost;
  } catch { return false; }
}
export async function sendMessagePush(identity: Identity, userId: string, message: any) {
  if (!pushEnabled) return;
  const subscriptions = await PushSubscription.findAll({ where: identity.role === "member" ? { role: "admin" } : { accountId: userId, role: "member" } });
  if (!subscriptions.length) return;
  const ids = subscriptions.map((row) => row.get("sessionId")).filter((id) => typeof id === "string" && id.length > 0);
  if (!ids.length) return;
  const sessions = await SessionRecord.findAll({ where: {
    id: { [Op.in]: ids },
    expiresAt: { [Op.gt]: new Date() },
  } });
  const active = new Set(sessions.map((row) => `${row.get("id")}:${row.get("accountId")}:${row.get("role")}`));
  await Promise.all(subscriptions.map(async (row) => {
    const sub = row.get();
    if (!active.has(`${sub.sessionId}:${sub.accountId}:${sub.role}`)) return;
    if (!validPushEndpoint(sub.endpoint)) return;
    try {
      await withPushSlot(async () => {
        // A queued notification may outlive a logout; recheck before delivery.
        if (!await SessionRecord.findOne({ where: { id: sub.sessionId, accountId: sub.accountId, role: sub.role, expiresAt: { [Op.gt]: new Date() } } })) return;
        return webPush.sendNotification({
        endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, JSON.stringify({
        title: message.senderName || (identity.role === "admin" ? "Support BCA" : "Membre"),
        body: (message.type === "voice" ? "Message vocal" : message.type === "image" ? `Photo${message.content ? " : " + message.content : ""}` : message.content || "Nouveau message").slice(0, 240),
        conversationId: message.conversationId, tag: message.conversationId,
        senderAvatarUrl: message.senderAvatarUrl || null,
      }), { TTL: 86400, urgency: "high", timeout: 10000 });
      });
    } catch (err: any) {
      if ([404, 410].includes(err.statusCode)) await row.destroy();
      else logger.warn({ status: err.statusCode }, "Push delivery failed");
    }
  }));
}

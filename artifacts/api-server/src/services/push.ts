import webPush from "web-push";
import { createECDH, createHash } from "node:crypto";
import { PushSubscription } from "@workspace/db";
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

export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname);
  } catch { return false; }
}
export async function sendMessagePush(identity: Identity, userId: string, message: any) {
  if (!pushEnabled) return;
  const subscriptions = await PushSubscription.findAll({ where: identity.role === "member" ? { role: "admin" } : { accountId: userId, role: "member" } });
  await Promise.all(subscriptions.map(async (row) => {
    const sub = row.get();
    if (!validPushEndpoint(sub.endpoint)) return;
    try {
      await webPush.sendNotification({
        endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, JSON.stringify({
        title: "BCA Messenger", body: "Vous avez reçu un nouveau message.",
        conversationId: message.conversationId, tag: message.conversationId,
      }), { TTL: 86400, urgency: "high", timeout: 10000 });
    } catch (err: any) {
      if ([404, 410].includes(err.statusCode)) await row.destroy();
      else logger.warn({ status: err.statusCode }, "Push delivery failed");
    }
  }));
}

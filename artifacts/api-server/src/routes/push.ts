import { Router } from "express";
import { randomUUID } from "node:crypto";
import { PushSubscription } from "@workspace/db";
import { SubscribePushBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { pushConfig, validPushEndpoint } from "../services/push";

const router = Router();
router.get("/push/config", requireAuth, (_req, res) => { res.json(pushConfig); });
router.post("/push/subscriptions", requireAuth, async (req, res) => {
  const parsed = SubscribePushBody.safeParse(req.body);
  if (!pushConfig.enabled) { res.status(503).json({ error: "Configurez VAPID_SUBJECT pour activer les notifications push." }); return; }
  if (!parsed.success || !validPushEndpoint(parsed.data.endpoint)) {
    res.status(400).json({ error: "Abonnement push invalide ou fournisseur non autorisé." }); return;
  }
  const { endpoint, keys } = parsed.data;
  if (keys.auth.length > 256 || keys.p256dh.length > 256) { res.status(400).json({ error: "Clés invalides." }); return; }
  const existing = await PushSubscription.findOne({ where: { endpoint } });
  const values = { accountId: req.identity!.id, role: req.identity!.role, sessionId: req.identity!.sessionId, endpoint, ...keys };
  if (existing) await existing.update(values);
  else await PushSubscription.create({ id: randomUUID(), ...values });
  res.json({ ok: true });
});
export default router;

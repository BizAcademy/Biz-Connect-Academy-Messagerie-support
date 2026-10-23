import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { Admin, User, SessionRecord, PushSubscription } from "@workspace/db";
import { LoginBody, DemoLoginBody } from "@workspace/api-zod";
import { demoAvailable, hashToken } from "../lib/config";
import { verifyAcademyMember } from "../services/accounts";
import { verifyAccess, renewSession, newSession, sessionPayload, clearSessionCookies } from "../middlewares/auth";
import { disconnectSession } from "../services/realtime";

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans 15 minutes." } });
router.get("/auth/session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const identity = await verifyAccess(req.cookies?.bc_access) || await renewSession(req, res, false);
  res.json(await sessionPayload(req, res, identity));
});
router.post("/auth/login", limiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Veuillez renseigner vos identifiants." }); return; }
  const { username, credential } = parsed.data;
  // Privileges come exclusively from the database, never a role sent by a client.
  const admin = await Admin.findOne({ where: { username: username.trim() } });
  const role = admin ? "admin" as const : "member" as const;
  const user = admin || await verifyAcademyMember(username.trim(), credential);
  const valid = user && (role === "member" || await bcrypt.compare(credential, user.get("credentialHash") as string));
  if (!valid) {
    // Equalize missing-username attempts without recording personal identifiers.
    if (!user) await bcrypt.hash(credential, 12);
    req.log.warn({ role }, "Login failed");
    res.status(401).json({ error: "Identifiants incorrects. Vérifiez vos informations Biz Connect Academy." }); return;
  }
  const identity = { id: user!.get("id") as string, role };
  await newSession(res, identity);
  req.log.info({ role }, "Login successful");
  res.json(await sessionPayload(req, res, identity));
});
router.post("/auth/demo", limiter, async (req, res) => {
  if (!demoAvailable) { res.status(404).json({ error: "Indisponible" }); return; }
  const parsed = DemoLoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Rôle invalide." }); return; }
  const role = "member" as const;
  const user = await User.findOne({ where: { isDemo: true }, order: [["createdAt", "ASC"]] });
  if (!user) { res.status(503).json({ error: "Initialisez les comptes de démonstration avec le script seed." }); return; }
  const identity = { id: user.get("id") as string, role };
  await newSession(res, identity);
  res.json(await sessionPayload(req, res, identity));
});
router.post("/auth/refresh", limiter, async (req, res) => {
  const identity = await renewSession(req, res, true);
  if (!identity) { clearSessionCookies(res); res.status(401).json({ error: "Session expirée." }); return; }
  res.json(await sessionPayload(req, res, identity));
});
router.post("/auth/logout", async (req, res) => {
  const identity = await verifyAccess(req.cookies?.bc_access);
  const record = req.cookies?.bc_refresh ? await SessionRecord.findOne({ where: { refreshHash: hashToken(req.cookies.bc_refresh) } }) : null;
  if (record) await record.destroy();
  const sessionId = identity?.sessionId || record?.get("id") as string | undefined;
  if (sessionId) {
    disconnectSession(sessionId);
    await PushSubscription.destroy({ where: { sessionId } });
  }
  clearSessionCookies(res);
  res.json({ ok: true });
});
export default router;

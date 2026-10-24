import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { Admin, User, SessionRecord, PushSubscription } from "@workspace/db";
import { LoginBody, DemoLoginBody } from "@workspace/api-zod";
import { demoAvailable, hashToken } from "../lib/config";
import { loginOrCreateMember, normalizePhone } from "../services/accounts";
import { verifyAccess, renewSession, newSession, sessionPayload, clearSessionCookies } from "../middlewares/auth";
import { disconnectSession } from "../services/realtime";

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans 15 minutes." } });
router.get("/auth/session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  // Renew the persistent cookie even while the 15-minute access token is valid.
  const identity = await renewSession(req, res, false) || await verifyAccess(req.cookies?.bc_access);
  res.json(await sessionPayload(req, res, identity));
});
router.post("/auth/login", limiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Veuillez renseigner vos identifiants." }); return; }
  const { username, credential } = parsed.data;
  if (!username.trim()) { res.status(400).json({ error: "Veuillez renseigner votre nom d’utilisateur." }); return; }
  // Privileges come exclusively from the database, never a role sent by a client.
  const admin = await Admin.findOne({ where: { username: username.trim() } });
  if (!admin && !normalizePhone(credential)) {
    res.status(400).json({ error: "Renseignez un numéro de téléphone valide, avec 7 à 15 chiffres." }); return;
  }
  const role = admin ? "admin" as const : "member" as const;
  let user;
  try { user = admin || await loginOrCreateMember(username.trim(), credential); }
  catch (error) {
    if ((error as Error).name === "SequelizeUniqueConstraintError") {
      res.status(503).json({ error: "Mise à jour des sessions requise : lancez db:upgrade dans Plesk. Aucun historique n’a été supprimé." }); return;
    }
    throw error;
  }
  const valid = user && (role === "member" || await bcrypt.compare(credential, user.get("credentialHash") as string));
  if (!valid) {
    // Equalize missing-username attempts without recording personal identifiers.
    if (!user) await bcrypt.hash(credential, 12);
    req.log.warn({ role }, "Login failed");
    res.status(401).json({ error: "Nom ou numéro incorrect. Pour le support, vérifiez votre mot de passe administrateur." }); return;
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

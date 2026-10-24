import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";
import { SessionRecord } from "@workspace/db";
import { jwtKey, production, demoAvailable, hashToken } from "../lib/config";
import { publicAccount, type Identity } from "../services/accounts";

declare global { namespace Express { interface Request { identity?: Identity } } }
const cookieOptions = { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/" };
// Browsers cap persistent cookies at 400 days. Renew on visits and refreshes,
// rather than imposing the former fixed 30-day sign-in deadline.
export const sessionMaxAge = 400 * 86400000;
const csrfSign = (s: string) => createHmac("sha256", jwtKey).update(s).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function csrfToken(req: Request, res: Response) {
  let token = req.cookies?.bc_csrf as string | undefined;
  const [nonce, signature] = (token || "").split(".");
  if (!nonce || !signature || !equal(signature, csrfSign(nonce))) {
    const nonce = randomBytes(24).toString("hex");
    token = `${nonce}.${csrfSign(nonce)}`;
  }
  res.cookie("bc_csrf", token, { ...cookieOptions, maxAge: sessionMaxAge });
  return token!;
}
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const token = req.get("x-csrf-token") || "";
  const [nonce, signature] = token.split(".");
  if (!nonce || !signature || !equal(signature, csrfSign(nonce)) || !equal(token, req.cookies?.bc_csrf || "")) {
    res.status(403).json({ error: "Session de sécurité expirée. Actualisez la page." }); return;
  }
  next();
}
export async function verifyAccess(token?: string): Promise<Identity | null> {
  try {
    if (!token) return null;
    const p = jwt.verify(token, jwtKey, { algorithms: ["HS256"], issuer: "biz-connect" }) as jwt.JwtPayload;
    if (typeof p.sub !== "string" || !["member", "admin"].includes(p.role) || typeof p.sid !== "string") return null;
    const session = await SessionRecord.findOne({ where: { id: p.sid, accountId: p.sub, role: p.role, expiresAt: { [Op.gt]: new Date() } } });
    return session ? { id: p.sub, role: p.role, sessionId: p.sid } : null;
  } catch { return null; }
}
function accessCookie(res: Response, identity: Identity, sessionId: string) {
  const token = jwt.sign({ role: identity.role, sid: sessionId }, jwtKey, {
    algorithm: "HS256", subject: identity.id, issuer: "biz-connect", expiresIn: "15m",
  });
  res.cookie("bc_access", token, { ...cookieOptions, maxAge: 15 * 60000 });
}
export async function newSession(res: Response, identity: Identity) {
  const refresh = randomBytes(48).toString("hex");
  const session = await SessionRecord.create({
    id: crypto.randomUUID(), accountId: identity.id, role: identity.role,
    refreshHash: hashToken(refresh), expiresAt: new Date(Date.now() + sessionMaxAge),
  });
  accessCookie(res, identity, session.get("id") as string);
  res.cookie("bc_refresh", refresh, { ...cookieOptions, maxAge: sessionMaxAge });
}
export async function renewSession(req: Request, res: Response, rotate: boolean): Promise<Identity | null> {
  const token = req.cookies?.bc_refresh;
  if (typeof token !== "string") return null;
  const record = await SessionRecord.findOne({ where: { refreshHash: hashToken(token), expiresAt: { [Op.gt]: new Date() } } });
  if (!record) return null;
  const identity: Identity = { id: record.get("accountId") as string, role: record.get("role") as Identity["role"] };
  if (!await publicAccount(identity)) return null;
  // Conditional update cannot resurrect a session removed by logout. Refresh
  // rotation still atomically consumes the previous token, including on races.
  const nextToken = rotate ? randomBytes(48).toString("hex") : token;
  const [count] = await SessionRecord.update({
    refreshHash: hashToken(nextToken), expiresAt: new Date(Date.now() + sessionMaxAge),
  }, { where: { id: record.get("id"), refreshHash: hashToken(token), expiresAt: { [Op.gt]: new Date() } } });
  if (!count) return null;
  accessCookie(res, identity, record.get("id") as string);
  res.cookie("bc_refresh", nextToken, { ...cookieOptions, maxAge: sessionMaxAge });
  identity.sessionId = record.get("id") as string;
  return identity;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const identity = await verifyAccess(req.cookies?.bc_access);
  if (!identity) { res.status(401).json({ error: "Veuillez vous connecter." }); return; }
  req.identity = identity;
  res.set("Cache-Control", "no-store");
  next();
}
export async function sessionPayload(req: Request, res: Response, identity: Identity | null) {
  return { account: identity ? await publicAccount(identity) : null, csrfToken: csrfToken(req, res), demoAvailable };
}
export function clearSessionCookies(res: Response) {
  res.clearCookie("bc_access", cookieOptions); res.clearCookie("bc_refresh", cookieOptions);
}

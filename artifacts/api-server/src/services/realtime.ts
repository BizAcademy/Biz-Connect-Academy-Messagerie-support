import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Presence, Conversation, SessionRecord, MessageRecord } from "@workspace/db";
import { Op } from "sequelize";
import { verifyAccess } from "../middlewares/auth";
import { appOrigin } from "../lib/config";
import { logger } from "../lib/logger";
import type { Identity } from "./accounts";

let io: Server | undefined;
const online = new Map<string, { role: string; sockets: Set<string> }>();
export const isOnline = (id: string) => !!online.get(id)?.sockets.size;
export const isSupportOnline = () => [...online.values()].some((a) => a.role === "admin" && a.sockets.size > 0);
export function notifyConversation(conversationId: string, userId: string) {
  io?.to("admins").to(`member:${userId}`).emit("changed", { conversationId });
}
export function disconnectSession(id: string) {
  io?.in(`session:${id}`).disconnectSockets(true);
}
export async function initRealtime(server: HttpServer) {
  io = new Server(server, {
    path: "/api/socket.io",
    maxHttpBufferSize: 16000,
    allowRequest(req, cb) {
      const origin = req.headers.origin;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      try { cb(null, !origin || (appOrigin ? origin === appOrigin : new URL(origin).host === host)); }
      catch { cb(null, false); }
    },
  });
  io.use(async (socket, next) => {
    try {
      const cookies = Object.fromEntries((socket.request.headers.cookie || "").split(";").map((s) => {
        const i = s.indexOf("="); return [s.slice(0, i).trim(), decodeURIComponent(s.slice(i + 1))];
      }));
      if (!socket.handshake.auth.csrfToken || cookies.bc_csrf !== socket.handshake.auth.csrfToken) { next(new Error("CSRF")); return; }
      const identity = await verifyAccess(cookies.bc_access);
      if (!identity) { next(new Error("Unauthorized")); return; }
      socket.data.identity = identity;
      next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", async (socket) => {
    const identity = socket.data.identity as Identity;
    socket.join(identity.role === "admin" ? "admins" : `member:${identity.id}`);
    socket.join(`session:${identity.sessionId}`);
    const state = online.get(identity.id) || { role: identity.role, sockets: new Set<string>() };
    state.sockets.add(socket.id); online.set(identity.id, state);
    await Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() });
    // Receipt is independent from opening/reading a conversation. Reconnecting
    // recipients acknowledge pending messages without marking any as read.
    const conversations = await Conversation.findAll({
      ...(identity.role === "member" ? { where: { userId: identity.id } } : {}),
      attributes: ["id", "userId"],
    });
    const conversationIds = conversations.map((c) => c.get("id"));
    const [delivered] = await MessageRecord.update({ status: "delivered" }, { where: {
      conversationId: { [Op.in]: conversationIds },
      senderRole: { [Op.ne]: identity.role }, status: "sent",
    } });
    if (delivered) for (const c of conversations) notifyConversation(c.get("id") as string, c.get("userId") as string);
    // Only agents see all member presence; members only see support presence.
    io?.to("admins").emit("presence", { accountId: identity.id });
    if (identity.role === "admin") io?.emit("presence", { role: "admin" });
    let lastTyping = 0;
    socket.on("typing", async (data) => {
      if (Date.now() - lastTyping < 300 || typeof data?.conversationId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.conversationId)) return;
      lastTyping = Date.now();
      const c = await Conversation.findByPk(data.conversationId);
      if (!c || (identity.role !== "admin" && c.get("userId") !== identity.id)) return;
      const room = identity.role === "admin" ? `member:${c.get("userId")}` : "admins";
      socket.to(room).emit("typing", { conversationId: data.conversationId, role: identity.role, active: data.active === true });
    });
    const interval = setInterval(async () => {
      try {
        const record = await SessionRecord.findByPk(identity.sessionId);
        if (!record || new Date(record.get("expiresAt") as string).getTime() < Date.now()) { socket.disconnect(true); return; }
        await Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() });
      } catch (err) { logger.warn({ err }, "Presence heartbeat failed"); }
    }, 60000);
    socket.on("disconnect", async () => {
      clearInterval(interval);
      state.sockets.delete(socket.id);
      if (!state.sockets.size) online.delete(identity.id);
      await Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() });
      io?.to("admins").emit("presence", { accountId: identity.id });
      if (identity.role === "admin") io?.emit("presence", { role: "admin" });
    });
  });
}

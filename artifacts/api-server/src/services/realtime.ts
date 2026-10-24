import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Presence, Conversation, SessionRecord, MessageRecord } from "@workspace/db";
import { Op } from "sequelize";
import { verifyAccess } from "../middlewares/auth";
import { appOrigin } from "../lib/config";
import { logger } from "../lib/logger";
import type { Identity } from "./accounts";
import { persistMessage, MessageSendError } from "./message-send";

let io: Server | undefined;
const online = new Map<string, { role: string; sockets: Set<string> }>();
export const isOnline = (id: string) => !!online.get(id)?.sockets.size;
export const isSupportOnline = () => [...online.values()].some((a) => a.role === "admin" && a.sockets.size > 0);
export function notifyConversation(conversationId: string, userId: string) {
  io?.to("admins").to(`member:${userId}`).emit("changed", { conversationId });
}
export function emitNewMessage(conversationId: string, userId: string, message: unknown) {
  io?.to("admins").to(`member:${userId}`).emit("message:new", { conversationId, message });
  io?.to("admins").to(`member:${userId}`).emit("changed", { conversationId, realtimeVersion: 2 });
}
export function emitReceipt(conversationId: string, userId: string, receipt: {
  status: "delivered" | "read"; senderRole?: string; messageId?: string; before?: string;
}) {
  io?.to("admins").to(`member:${userId}`).emit("messages:status", { conversationId, ...receipt });
  io?.to("admins").to(`member:${userId}`).emit("changed", { conversationId, realtimeVersion: 2 });
}
export function emitDeletion(conversationId: string, userId: string, messageId: string, only?: Identity) {
  const target = only ? io?.to(`account:${only.role}:${only.id}`) : io?.to("admins").to(`member:${userId}`);
  target?.emit("message:deleted", { conversationId, messageId, global: !only });
  target?.emit("changed", { conversationId, realtimeVersion: 2 });
}
export function disconnectSession(id: string) {
  io?.in(`session:${id}`).disconnectSockets(true);
}
export async function initRealtime(server: HttpServer) {
  io = new Server(server, {
    path: "/api/socket.io",
    maxHttpBufferSize: 64000,
    pingInterval: 25000,
    pingTimeout: 20000,
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
  io.on("connection", (socket) => {
    const identity = socket.data.identity as Identity;
    socket.join(identity.role === "admin" ? "admins" : `member:${identity.id}`);
    socket.join(`session:${identity.sessionId}`);
    socket.join(`account:${identity.role}:${identity.id}`);
    const wasOnline = isOnline(identity.id);
    const state = online.get(identity.id) || { role: identity.role, sockets: new Set<string>() };
    state.sockets.add(socket.id); online.set(identity.id, state);
    const presence = () => {
      const data = { accountId: identity.id, role: identity.role, online: isOnline(identity.id), lastSeen: new Date().toISOString() };
      io?.to("admins").emit("presence", data);
      // Members learn aggregate support presence, never other members' identity.
      if (identity.role === "admin") io?.emit("support:presence", { online: isSupportOnline(), lastSeen: data.lastSeen });
    };
    if (!wasOnline) presence();
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const authorized = new Map<string, string>();
    const lastTyping = new Map<string, number>();
    let lastTypingPacket = 0;
    const conversationOwner = async (id: string) => {
      if (authorized.has(id)) return authorized.get(id)!;
      const c = await Conversation.findByPk(id);
      if (!c || (identity.role !== "admin" && c.get("userId") !== identity.id)) return null;
      if (authorized.size >= 100) authorized.delete(authorized.keys().next().value!);
      const userId = String(c.get("userId"));
      authorized.set(id, userId); return userId;
    };
    const stopTyping = (id: string) => {
      clearTimeout(typingTimers.get(id)); typingTimers.delete(id);
      const room = identity.role === "admin" ? `member:${authorized.get(id)}` : "admins";
      socket.to(room).emit("typing", { conversationId: id, role: identity.role, source: socket.id, active: false });
    };
    socket.on("typing", async (data) => {
      if (typeof data?.conversationId !== "string" || typeof data.active !== "boolean" || !/^[a-f0-9-]{36}$/i.test(data.conversationId)) return;
      const id = data.conversationId;
      if (data.active && Date.now() - lastTypingPacket < 300) return;
      if (!data.active && !authorized.has(id)) return;
      lastTypingPacket = Date.now();
      // Always forward stop; dropping it leaves a stale “typing…” indicator.
      if (data.active && Date.now() - (lastTyping.get(id) || 0) < 900) return;
      lastTyping.set(id, Date.now());
      if (lastTyping.size > 100) lastTyping.delete(lastTyping.keys().next().value!);
      try {
        const owner = await conversationOwner(id);
        if (!owner || !socket.connected) return;
        if (!data.active) { stopTyping(id); return; }
        clearTimeout(typingTimers.get(id));
        const room = identity.role === "admin" ? `member:${owner}` : "admins";
        socket.to(room).volatile.emit("typing", { conversationId: id, role: identity.role, source: socket.id, active: true });
        typingTimers.set(id, setTimeout(() => stopTyping(id), 5000));
      } catch (err) { logger.warn({ err }, "Typing event failed"); }
    });
    let packetWindow = Date.now(), packets = 0;
    socket.on("message:send", async (data, ack) => {
      if (typeof ack !== "function") return;
      if (Date.now() - packetWindow > 60000) { packets = 0; packetWindow = Date.now(); }
      if (++packets > 120) { ack({ ok: false, status: 429, error: "Trop de messages. Patientez un instant." }); return; }
      try {
        const session = await SessionRecord.findOne({ where: { id: identity.sessionId, accountId: identity.id, role: identity.role, expiresAt: { [Op.gt]: new Date() } } });
        if (!session || !socket.connected) { ack({ ok: false, status: 401, error: "Session expirée." }); socket.disconnect(true); return; }
        if (typeof data?.conversationId !== "string") throw new MessageSendError(400, "Conversation invalide.");
        const message = await persistMessage(identity, data.conversationId, data.input);
        ack({ ok: true, message });
      } catch (error) {
        if (!(error instanceof MessageSendError)) logger.error({ err: error }, "Socket message failed");
        ack({ ok: false, status: error instanceof MessageSendError ? error.status : 500, error: error instanceof MessageSendError ? error.message : "Envoi momentanément impossible." });
      }
    });
    socket.on("message:received", async (data) => {
      if (typeof data?.conversationId !== "string" || typeof data?.messageId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.messageId)) return;
      try {
        const owner = await conversationOwner(data.conversationId);
        if (!owner || !socket.connected) return;
        const [count] = await MessageRecord.update({ status: "delivered" }, { where: {
          id: data.messageId, conversationId: data.conversationId, senderRole: { [Op.ne]: identity.role }, status: "sent",
        } });
        if (count) emitReceipt(data.conversationId, owner, { messageId: data.messageId, status: "delivered" });
      } catch (err) { logger.warn({ err }, "Message receipt failed"); }
    });
    const interval = setInterval(async () => {
      try {
        const record = await SessionRecord.findByPk(identity.sessionId);
        if (!record || new Date(record.get("expiresAt") as string).getTime() < Date.now()) { socket.disconnect(true); return; }
        await Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() });
      } catch (err) { logger.warn({ err }, "Presence heartbeat failed"); }
    }, 60000);
    socket.on("disconnect", () => {
      clearInterval(interval);
      for (const id of typingTimers.keys()) stopTyping(id);
      state.sockets.delete(socket.id);
      if (!state.sockets.size) {
        online.delete(identity.id); presence();
        void Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() }).catch((err) => logger.warn({ err }, "Last-seen update failed"));
      }
    });
    // Register disconnect BEFORE asynchronous bootstrap to avoid ghost presence.
    void (async () => {
      await Presence.upsert({ accountId: identity.id, role: identity.role, lastSeen: new Date() });
      if (!socket.connected) return;
      socket.emit("support:presence", { online: isSupportOnline(), lastSeen: null });
      const conversations = await Conversation.findAll({
        ...(identity.role === "member" ? { where: { userId: identity.id } } : {}),
        attributes: ["id", "userId"],
      });
      if (!socket.connected) return;
      const before = new Date();
      const [count] = await MessageRecord.update({ status: "delivered" }, { where: {
        conversationId: { [Op.in]: conversations.map((c) => c.get("id")) },
        createdAt: { [Op.lte]: before }, senderRole: { [Op.ne]: identity.role }, status: "sent",
      } });
      if (count) for (const c of conversations) emitReceipt(String(c.get("id")), String(c.get("userId")), { status: "delivered", senderRole: identity.role === "member" ? "admin" : "member", before: before.toISOString() });
    })().catch((err) => { logger.error({ err }, "Realtime bootstrap failed"); socket.disconnect(true); });
  });
}

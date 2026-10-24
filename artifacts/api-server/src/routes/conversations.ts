import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { Conversation, MessageRecord, PrivateFile, sequelize } from "@workspace/db";
import {
  ListConversationsQueryParams, ListConversationsResponse, GetSummaryResponse,
  UpdateConversationBody, SendMessageBody, GetMessagesResponse, SendMessageResponse,
  GetMessagesQueryParams, DeleteMessageQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { authorizeConversation, inbox, serializeMessages, deliverPending } from "../services/conversations";
import { notifyConversation, isOnline, isSupportOnline } from "../services/realtime";
import { sendMessagePush } from "../services/push";

const router = Router();
router.use("/conversations", requireAuth);
router.get("/conversations", async (req, res) => {
  const parsed = ListConversationsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Filtres invalides." }); return; }
  let rows = await inbox(req.identity!);
  const { search, filter } = parsed.data;
  if (search) rows = rows.filter((c) => c.username.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  if (filter === "unread") rows = rows.filter((c) => c.unreadCount > 0);
  if (filter === "read") rows = rows.filter((c) => c.unreadCount === 0);
  if (filter === "favorites") rows = rows.filter((c) => c.favorite);
  res.json(ListConversationsResponse.parse(rows));
});
router.get("/conversations/summary", async (req, res) => {
  const rows = await inbox(req.identity!);
  res.json(GetSummaryResponse.parse({
    total: rows.length, unread: rows.filter((c) => c.unreadCount > 0).length,
    unreadMessages: rows.reduce((sum, c) => sum + c.unreadCount, 0),
    read: rows.filter((c) => c.unreadCount === 0).length,
    favorites: rows.filter((c) => c.favorite).length, online: rows.filter((c) => c.online).length,
  }));
});
router.patch("/conversations/:id", async (req, res) => {
  const c = await authorizeConversation(String(req.params.id), req.identity!);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  if (req.identity!.role !== "admin") { res.status(403).json({ error: "Réservé au support." }); return; }
  const parsed = UpdateConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Mise à jour invalide." }); return; }
  await c.update(parsed.data);
  notifyConversation(c.get("id") as string, c.get("userId") as string);
  res.json({ ok: true });
});
router.get("/conversations/:id/messages", async (req, res) => {
  const c = await authorizeConversation(String(req.params.id), req.identity!);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  const delivered = await deliverPending(c.get("id") as string, req.identity!);
  const params = GetMessagesQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: "Page invalide." }); return; }
  const before = params.data.before ? await MessageRecord.findOne({ where: { id: params.data.before, conversationId: c.get("id") } }) : null;
  if (req.query.before && !before) { res.status(400).json({ error: "Page invalide." }); return; }
  const rows = await MessageRecord.findAll({
    where: {
      conversationId: c.get("id"),
      ...(before ? { [Op.or]: [
        { createdAt: { [Op.lt]: before.get("createdAt") } },
        { createdAt: before.get("createdAt"), id: { [Op.lt]: before.get("id") } },
      ] } : {}),
    }, order: [["createdAt", "DESC"], ["id", "DESC"]], limit: 100,
  });
  // Loading does not mark read: the visible client explicitly acknowledges it.
  const key = `${req.identity!.role}:${req.identity!.id}`;
  const visible = rows.filter((r) => !JSON.parse(String(r.get("hiddenFor") || "[]")).includes(key));
  res.setHeader("X-History-Cursor", rows.length === 100 ? String(rows[rows.length - 1]!.get("id")) : "");
  res.json(GetMessagesResponse.parse(await serializeMessages(visible.reverse())));
  if (delivered) notifyConversation(c.get("id") as string, c.get("userId") as string);
});
router.post("/conversations/:id/messages", async (req, res) => {
  const identity = req.identity!;
  const c = await authorizeConversation(String(req.params.id), identity);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Message invalide (10 000 caractères maximum)." }); return; }
  const data = parsed.data;
  if (data.replyToId && !await MessageRecord.findOne({ where: { id: data.replyToId, conversationId: c.get("id") } })) {
    res.status(400).json({ error: "Le message cité n’existe plus dans cette conversation." }); return;
  }
  if (data.type === "text" && !data.content?.trim()) { res.status(400).json({ error: "Le message est vide." }); return; }
  let file: Awaited<ReturnType<typeof PrivateFile.findByPk>> = null;
  if (data.type !== "text") {
    file = data.fileId ? await PrivateFile.findOne({ where: {
      id: data.fileId, ownerId: identity.id, conversationId: c.get("id"), purpose: data.type,
    } }) : null;
    if (!file) { res.status(400).json({ error: "Pièce jointe invalide." }); return; }
  }
  const created = await sequelize.transaction(async (transaction) => {
    const message = await MessageRecord.create({
      id: randomUUID(), conversationId: c.get("id"), senderId: identity.id, senderRole: identity.role,
      type: data.type, content: data.content?.trim() || "", fileId: file?.get("id") || null,
      duration: data.type === "voice" ? file?.get("duration") : null,
      status: (identity.role === "admin" ? isOnline(c.get("userId") as string) : isSupportOnline()) ? "delivered" : "sent",
      isRead: false, createdAt: new Date(),
      replyToId: data.replyToId || null, hiddenFor: "[]",
    }, { transaction });
    await c.update({ lastMessageAt: new Date() }, { transaction });
    return message;
  });
  const [message] = await serializeMessages([created]);
  notifyConversation(c.get("id") as string, c.get("userId") as string);
  void sendMessagePush(identity, c.get("userId") as string, message).catch((err) => req.log.warn({ err }, "Push failed"));
  res.status(201).json(SendMessageResponse.parse(message));
});
router.delete("/conversations/:id/messages/:messageId", async (req, res) => {
  const identity = req.identity!;
  const c = await authorizeConversation(String(req.params.id), identity);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  const parsed = DeleteMessageQueryParams.safeParse(req.query);
  if (!parsed.success || !/^[a-f0-9-]{36}$/i.test(String(req.params.messageId))) { res.status(400).json({ error: "Choisissez un message et la portée de suppression." }); return; }
  const scope = parsed.data.scope;
  let found = false;
  await sequelize.transaction(async (transaction) => {
    const row = await MessageRecord.findOne({ where: { id: String(req.params.messageId), conversationId: c.get("id") }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) return;
    found = true;
    if (scope === "everyone") {
      await row.destroy({ transaction });
    } else {
      const hidden: string[] = JSON.parse(String(row.get("hiddenFor") || "[]"));
      const key = `${identity.role}:${identity.id}`;
      if (!hidden.includes(key)) hidden.push(key);
      await row.update({ hiddenFor: JSON.stringify(hidden) }, { transaction });
    }
  });
  if (!found) { res.status(404).json({ error: "Message introuvable." }); return; }
  notifyConversation(c.get("id") as string, c.get("userId") as string);
  res.json({ ok: true });
});
router.post("/conversations/:id/read", async (req, res) => {
  const c = await authorizeConversation(String(req.params.id), req.identity!);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  const [count] = await MessageRecord.update({ isRead: true, status: "read" }, { where: {
    conversationId: c.get("id"), senderRole: { [Op.ne]: req.identity!.role }, isRead: false,
  } });
  if (count) notifyConversation(c.get("id") as string, c.get("userId") as string);
  res.json({ ok: true });
});
export default router;

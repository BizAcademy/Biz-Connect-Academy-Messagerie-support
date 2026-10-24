import { Router } from "express";
import { Op } from "sequelize";
import { MessageRecord, sequelize } from "@workspace/db";
import {
  ListConversationsQueryParams, ListConversationsResponse, GetSummaryResponse,
  UpdateConversationBody, GetMessagesResponse,
  GetMessagesQueryParams, DeleteMessageQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { authorizeConversation, inbox, serializeMessages, deliverPending } from "../services/conversations";
import { notifyConversation, emitReceipt, emitDeletion } from "../services/realtime";
import { persistMessage, MessageSendError } from "../services/message-send";

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
  const receivedBefore = new Date();
  const delivered = await deliverPending(c.get("id") as string, req.identity!, receivedBefore);
  const params = GetMessagesQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: "Page invalide." }); return; }
  if (params.data.before && params.data.around) { res.status(400).json({ error: "Choisissez une seule destination." }); return; }
  if (params.data.around) {
    const target = await MessageRecord.findOne({ where: { id: params.data.around, conversationId: c.get("id") } });
    const key = `${req.identity!.role}:${req.identity!.id}`;
    if (!target || JSON.parse(String(target.get("hiddenFor") || "[]")).includes(key)) {
      res.status(404).json({ error: "Ce message n’est plus disponible." }); return;
    }
    const time = target.get("createdAt"), id = target.get("id");
    const [older, newer] = await Promise.all([
      MessageRecord.findAll({ where: { conversationId: c.get("id"), [Op.or]: [{ createdAt: { [Op.lt]: time } }, { createdAt: time, id: { [Op.lte]: id } }] }, order: [["createdAt", "DESC"], ["id", "DESC"]], limit: 40 }),
      MessageRecord.findAll({ where: { conversationId: c.get("id"), [Op.or]: [{ createdAt: { [Op.gt]: time } }, { createdAt: time, id: { [Op.gt]: id } }] }, order: [["createdAt", "ASC"], ["id", "ASC"]], limit: 40 }),
    ]);
    const visible = [...older.reverse(), ...newer].filter((r) => !JSON.parse(String(r.get("hiddenFor") || "[]")).includes(key));
    res.setHeader("X-History-Cursor", older.length === 40 ? String(older[0]!.get("id")) : "");
    res.json(GetMessagesResponse.parse(await serializeMessages(visible)));
    if (delivered) emitReceipt(String(c.get("id")), String(c.get("userId")), { status: "delivered", senderRole: req.identity!.role === "member" ? "admin" : "member", before: receivedBefore.toISOString() });
    return;
  }
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
  if (delivered) emitReceipt(String(c.get("id")), String(c.get("userId")), { status: "delivered", senderRole: req.identity!.role === "member" ? "admin" : "member", before: receivedBefore.toISOString() });
});
router.post("/conversations/:id/messages", async (req, res) => {
  try { res.status(201).json(await persistMessage(req.identity!, String(req.params.id), req.body)); }
  catch (error) {
    if (!(error instanceof MessageSendError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
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
  emitDeletion(String(c.get("id")), String(c.get("userId")), String(req.params.messageId), scope === "me" ? identity : undefined);
  res.json({ ok: true });
});
router.post("/conversations/:id/read", async (req, res) => {
  const c = await authorizeConversation(String(req.params.id), req.identity!);
  if (!c) { res.status(404).json({ error: "Conversation introuvable." }); return; }
  const before = new Date();
  const [count] = await MessageRecord.update({ isRead: true, status: "read" }, { where: {
    conversationId: c.get("id"), senderRole: { [Op.ne]: req.identity!.role }, isRead: false,
    createdAt: { [Op.lte]: before },
  } });
  if (count) emitReceipt(String(c.get("id")), String(c.get("userId")), { status: "read", senderRole: req.identity!.role === "member" ? "admin" : "member", before: before.toISOString() });
  res.json({ ok: true });
});
export default router;

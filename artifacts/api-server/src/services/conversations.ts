import { QueryTypes, Op } from "sequelize";
import { sequelize, Conversation, Presence, MessageRecord, User, Admin } from "@workspace/db";
import type { Identity } from "./accounts";
import { isOnline, isSupportOnline } from "./realtime";

export async function authorizeConversation(id: string, identity: Identity) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const c = await Conversation.findByPk(id);
  return c && (identity.role === "admin" || c.get("userId") === identity.id) ? c : null;
}
export async function inbox(identity: Identity) {
  const mysql = sequelize.getDialect() === "mysql";
  const avatar = mysql ? "CONCAT('/api/files/', u.avatar_file_id)" : "'/api/files/' || u.avatar_file_id";
  const accountId = mysql ? "c.user_id" : "c.user_id::text";
  const rows = await sequelize.query<any>(`
    SELECT c.id, c.user_id AS "userId", u.username, u.phone,
      CASE WHEN u.avatar_file_id IS NULL THEN NULL ELSE ${avatar} END AS "avatarUrl",
      c.favorite, c.last_message_at AS "lastMessageAt",
      COALESCE((SELECT CASE WHEN m.type='image' THEN 'Photo' WHEN m.type='voice' THEN 'Message vocal'
        ELSE m.content END FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1), 'Commencez la conversation') AS "lastMessage",
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_role <> :role AND NOT m.is_read) AS "unreadCount",
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS "messageCount",
      p.last_seen AS "lastSeen"
    FROM conversations c JOIN users u ON u.id=c.user_id LEFT JOIN presence p ON p.account_id=u.id
    WHERE (:role = 'admin' OR ${accountId} = :accountId)
      AND (:role = 'member' OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.sender_role='member'))
    ORDER BY c.last_message_at DESC
  `, { replacements: { role: identity.role, accountId: identity.id }, type: QueryTypes.SELECT });
  const supportPresence = identity.role === "member" ? await Presence.findOne({ where: { role: "admin" }, order: [["lastSeen", "DESC"]] }) : null;
  return rows.map((r) => ({
    ...r,
    favorite: Boolean(r.favorite),
    unreadCount: Number(r.unreadCount), messageCount: Number(r.messageCount),
    lastMessageAt: new Date(r.lastMessageAt).toISOString(),
    lastSeen: (identity.role === "member" ? supportPresence?.get("lastSeen") : r.lastSeen)
      ? new Date(identity.role === "member" ? supportPresence!.get("lastSeen") as string : r.lastSeen).toISOString() : null,
    online: identity.role === "admin" ? isOnline(r.userId) : isSupportOnline(),
  }));
}
export function serializeMessage(row: any, sender?: any) {
  const m = typeof row.get === "function" ? row.get() : row;
  return {
    id: m.id, conversationId: m.conversationId, senderId: m.senderId, senderRole: m.senderRole,
    senderName: sender?.username || (m.senderRole === "admin" ? "Support BCA Messenger" : "Membre"),
    senderAvatarUrl: sender?.avatarFileId ? `/api/files/${sender.avatarFileId}` : null,
    type: m.type, content: m.content, fileUrl: m.fileId ? `/api/files/${m.fileId}` : null,
    duration: m.duration ?? null, status: m.status, createdAt: new Date(m.createdAt).toISOString(),
  };
}
export async function serializeMessages(rows: any[]) {
  if (!rows.length) return [];
  const data = rows.map((r) => typeof r.get === "function" ? r.get() : r);
  const ids = (role: string) => [...new Set(data.filter((m) => m.senderRole === role).map((m) => m.senderId))];
  const [members, admins] = await Promise.all([
    User.findAll({ where: { id: { [Op.in]: ids("member") } }, attributes: ["id", "username", "avatarFileId"] }),
    Admin.findAll({ where: { id: { [Op.in]: ids("admin") } }, attributes: ["id", "username", "avatarFileId"] }),
  ]);
  const senders = new Map([...members, ...admins].map((s) => [s.get("id"), s.get()]));
  return data.map((m) => serializeMessage(m, senders.get(m.senderId)));
}
export async function deliverPending(conversationId: string, identity: Identity) {
  const [count] = await MessageRecord.update({ status: "delivered" }, { where: {
    conversationId, senderRole: { [Op.ne]: identity.role }, status: "sent",
  } });
  return count;
}

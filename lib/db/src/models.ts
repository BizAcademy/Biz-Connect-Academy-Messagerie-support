// Sequelize is used at runtime; the matching Drizzle schema describes the
// development schema to Replit's publish-time migration tooling.
import { Sequelize, DataTypes as D, type Model } from "sequelize";

export const sequelize = new Sequelize(process.env.DATABASE_URL!, {
  logging: false,
  pool: { max: 10, min: 0, idle: 10000 },
  define: { timestamps: false, underscored: true },
});
const id = () => ({ type: D.UUID, primaryKey: true });
const identity = () => ({
  id: id(),
  username: { type: D.TEXT, allowNull: false, unique: true },
  credentialHash: { type: D.TEXT, allowNull: false, field: "credential_hash" },
  phone: { type: D.TEXT, allowNull: false, defaultValue: "" },
  avatarFileId: { type: D.UUID, field: "avatar_file_id" },
  isDemo: { type: D.BOOLEAN, defaultValue: false, field: "is_demo" },
  createdAt: { type: D.DATE, defaultValue: D.NOW, field: "created_at" },
});
function model(name: string, tableName: string, attributes: Parameters<typeof sequelize.define>[1]) {
  return sequelize.define<Model<any, any>>(name, attributes, { tableName });
}
export const User = model("User", "users", identity());
export const Admin = model("Admin", "admins", identity());
export const SessionRecord = model("SessionRecord", "sessions", {
  id: id(), accountId: { type: D.UUID, field: "account_id" }, role: D.TEXT,
  refreshHash: { type: D.TEXT, field: "refresh_hash" }, expiresAt: { type: D.DATE, field: "expires_at" },
});
export const Presence = model("Presence", "presence", {
  accountId: { type: D.UUID, primaryKey: true, field: "account_id" },
  role: D.TEXT, lastSeen: { type: D.DATE, field: "last_seen" },
});
export const Conversation = model("Conversation", "conversations", {
  id: id(), userId: { type: D.UUID, field: "user_id" }, favorite: { type: D.BOOLEAN, defaultValue: false },
  lastMessageAt: { type: D.DATE, defaultValue: D.NOW, field: "last_message_at" },
});
export const PrivateFile = model("PrivateFile", "files", {
  id: id(), ownerId: { type: D.UUID, field: "owner_id" },
  conversationId: { type: D.UUID, field: "conversation_id" }, purpose: D.TEXT, path: D.TEXT,
  mime: D.TEXT, size: D.INTEGER, duration: D.DOUBLE,
  createdAt: { type: D.DATE, defaultValue: D.NOW, field: "created_at" },
});
export const MessageRecord = model("MessageRecord", "messages", {
  id: id(), conversationId: { type: D.UUID, field: "conversation_id" },
  senderId: { type: D.UUID, field: "sender_id" }, senderRole: { type: D.TEXT, field: "sender_role" },
  type: D.TEXT, content: { type: D.TEXT, defaultValue: "" }, fileId: { type: D.UUID, field: "file_id" },
  duration: D.DOUBLE, status: { type: D.TEXT, defaultValue: "sent" },
  isRead: { type: D.BOOLEAN, defaultValue: false, field: "is_read" },
  createdAt: { type: D.DATE, defaultValue: D.NOW, field: "created_at" },
});
export const PushSubscription = model("PushSubscription", "push_subscriptions", {
  id: id(), accountId: { type: D.UUID, field: "account_id" }, role: D.TEXT,
  sessionId: { type: D.UUID, field: "session_id" },
  endpoint: D.TEXT, p256dh: D.TEXT, auth: D.TEXT,
});

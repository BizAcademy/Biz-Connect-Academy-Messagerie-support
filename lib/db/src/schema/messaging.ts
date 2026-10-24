import { pgTable, uuid, text, timestamp, boolean, integer, doublePrecision, index } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const conversationsTable = pgTable("conversations", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => usersTable.id),
  favorite: boolean("favorite").notNull().default(false),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
});
export const filesTable = pgTable("files", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  purpose: text("purpose").notNull(),
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  duration: doublePrecision("duration"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id),
  senderId: uuid("sender_id").notNull(),
  senderRole: text("sender_role").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull().default(""),
  fileId: uuid("file_id").references(() => filesTable.id),
  duration: doublePrecision("duration"),
  status: text("status").notNull().default("sent"),
  isRead: boolean("is_read").notNull().default(false),
  replyToId: uuid("reply_to_id"),
  hiddenFor: text("hidden_for").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  index("messages_unread_idx").on(t.conversationId, t.isRead),
]);
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull(),
  role: text("role").notNull(),
  sessionId: uuid("session_id"),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
});

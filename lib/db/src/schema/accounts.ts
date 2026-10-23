import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

const identity = () => ({
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  credentialHash: text("credential_hash").notNull(),
  phone: text("phone").notNull().default(""),
  avatarFileId: uuid("avatar_file_id"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const usersTable = pgTable("users", identity());
export const adminsTable = pgTable("admins", identity());
export const sessionsTable = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull(),
  role: text("role").notNull(),
  refreshHash: text("refresh_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const presenceTable = pgTable("presence", {
  accountId: uuid("account_id").primaryKey(),
  role: text("role").notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

// No database access: regression checks for the MySQL adapter and inbox contract.
import assert from "node:assert/strict";
process.env.DATABASE_URL = "mysql://fixture:p%40ss%3A%2F%20%25@127.0.0.1:1/test";
process.env.SESSION_SECRET = "local-unit-test-secret-at-least-32-characters";
process.env.NODE_ENV = "test";
process.env.VAPID_SUBJECT = "";

const { sequelize, pool } = await import("@workspace/db");
const { inbox } = await import("./conversations");
assert.equal(sequelize.getDialect(), "mysql");
assert.equal(sequelize.config.password, "p@ss:/ %");
assert.equal(pool, null, "MySQL must not create a PostgreSQL pool");
const originalQuery = sequelize.query;
const fixture = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  username: "Membre é 👋", phone: "", avatarUrl: "/api/files/fixture",
  favorite: 0, lastMessageAt: "2026-10-24T00:00:00.000Z",
  lastMessage: "Bonjour 👋", unreadCount: "2", messageCount: "3", lastSeen: null,
};
sequelize.query = (async (sql: string) => {
  assert(sql.includes("CONCAT('/api/files/', u.avatar_file_id)"));
  assert(!sql.includes("::"), "No PostgreSQL casts in the MySQL inbox");
  assert(!sql.includes(" || "), "MySQL || means OR, not concatenation");
  return [fixture];
}) as typeof sequelize.query;
try {
  const [row] = await inbox({ id: fixture.userId, role: "admin" });
  assert.equal(row.favorite, false);
  assert.equal(row.unreadCount, 2);
  assert.equal(row.messageCount, 3);
  assert.equal(row.lastMessageAt, fixture.lastMessageAt);
  assert.equal(row.username, fixture.username);
  fixture.favorite = 1;
  assert.equal((await inbox({ id: fixture.userId, role: "admin" }))[0].favorite, true);
  console.log("PASS: MySQL driver, password encoding, no PG pool, dialect-specific inbox SQL and typed API results. No DB connection attempted.");
} finally {
  sequelize.query = originalQuery;
  await sequelize.close();
}

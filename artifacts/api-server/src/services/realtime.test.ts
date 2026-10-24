// Actual Socket.IO transport + simulated persistence. Never connects to a DB.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
process.env.DATABASE_URL = "mysql://fixture:fixture@127.0.0.1:1/test";
process.env.SESSION_SECRET = "local-realtime-fixture-secret-at-least-32-characters";
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "https://fixture.invalid";
const { Op } = await import("sequelize");
const { Presence, Conversation, SessionRecord, MessageRecord, PrivateFile, User, Admin, PushSubscription, sequelize } = await import("@workspace/db");
const { initRealtime, isOnline } = await import("./realtime");
const { persistMessage } = await import("./message-send");
const clientIo = createRequire(`${process.cwd()}/../biz-connect/package.json`)("socket.io-client").io;
const saved: Array<() => void> = [];
function replace(target: any, key: string, fn: any) { const previous = target[key]; saved.push(() => { target[key] = previous; }); target[key] = fn; }
const member = randomUUID(), support = randomUUID(), outsider = randomUUID(), conversationId = randomUUID();
const rows = new Map<string, any>();
const revoked = new Set<string>();
let inserts = 0;
const record = (data: any) => ({ get: (key?: string) => key ? data[key] : data, update: async (next: any) => Object.assign(data, next) });
const conversation = record({ id: conversationId, userId: member });
replace(Conversation, "findByPk", async (id: string) => id === conversationId ? conversation : null);
replace(Conversation, "findAll", async (options: any) => !options.where || options.where.userId === member ? [conversation] : []);
replace(Presence, "upsert", async () => []);
replace(SessionRecord, "findOne", async ({ where }: any) => revoked.has(where.id) ? null : record({ ...where, expiresAt: new Date(Date.now() + 60000) }));
replace(SessionRecord, "findByPk", async (id: string) => revoked.has(id) ? null : record({ expiresAt: new Date(Date.now() + 60000) }));
replace(User, "findAll", async () => [record({ id: member, username: "Fixture member" })]);
replace(Admin, "findAll", async () => [record({ id: support, username: "Fixture support" })]);
replace(PushSubscription, "findAll", async () => []);
replace(PrivateFile, "findOne", async () => null);
replace(sequelize, "transaction", async (run: any) => run({}));
replace(MessageRecord, "findByPk", async (id: string) => rows.has(id) ? record(rows.get(id)) : null);
replace(MessageRecord, "findOne", async ({ where }: any) => rows.has(where.id) && rows.get(where.id).conversationId === where.conversationId ? record(rows.get(where.id)) : null);
replace(MessageRecord, "findAll", async () => []);
replace(MessageRecord, "create", async (data: any) => {
  if (rows.has(data.id)) throw Object.assign(new Error("duplicate"), { name: "SequelizeUniqueConstraintError" });
  inserts++; rows.set(data.id, data); return record(data);
});
replace(MessageRecord, "update", async (next: any, { where }: any) => {
  let count = 0;
  for (const row of rows.values()) {
    if (where.id && row.id !== where.id) continue;
    if (typeof where.conversationId === "string" && row.conversationId !== where.conversationId) continue;
    if (where.conversationId?.[Op.in] && !where.conversationId[Op.in].includes(row.conversationId)) continue;
    if (where.senderRole?.[Op.ne] === row.senderRole || (where.status && where.status !== row.status)) continue;
    Object.assign(row, next); count++;
  }
  return [count];
});
const server = createServer();
const sockets: any[] = [];
const once = (socket: any, event: string, matches = (_: any) => true) => new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off(event, listener); reject(new Error(`Missing ${event}`)); }, 4000);
  const listener = (data: any) => { if (matches(data)) { clearTimeout(timeout); socket.off(event, listener); resolve(data); } };
  socket.on(event, listener);
});
try {
  await initRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  async function connect(id: string, role: string) {
    const sid = randomUUID();
    const token = jwt.sign({ role, sid }, process.env.SESSION_SECRET!, { subject: id, issuer: "biz-connect", expiresIn: "15m" });
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      path: "/api/socket.io", transports: ["websocket"], reconnection: false,
      auth: { csrfToken: "fixture-csrf" },
      extraHeaders: { Origin: "https://fixture.invalid", Cookie: `bc_access=${token}; bc_csrf=fixture-csrf` },
    });
    sockets.push(socket); await once(socket, "connect"); return { socket, sid };
  }
  const a = await connect(member, "member"), b = await connect(support, "admin"), c = await connect(outsider, "member");
  const id = randomUUID();
  const newMessage = once(b.socket, "message:new", (p) => p.message.id === id);
  const reply = await a.socket.timeout(4000).emitWithAck("message:send", { conversationId, input: { type: "text", content: "Instantané", clientMessageId: id } });
  assert(reply.ok); assert.equal(reply.message.status, "sent");
  assert.equal((await newMessage).message.content, "Instantané");
  const receipt = once(a.socket, "messages:status", (p) => p.messageId === id);
  b.socket.emit("message:received", { conversationId, messageId: id });
  assert.equal((await receipt).status, "delivered");
  assert.equal(rows.get(id).status, "delivered");
  await a.socket.timeout(4000).emitWithAck("message:send", { conversationId, input: { type: "text", content: "Instantané", clientMessageId: id } });
  await persistMessage({ id: member, role: "member" }, conversationId, { type: "text", content: "Instantané", clientMessageId: id });
  assert.equal(inserts, 1, "Socket retry and HTTP fallback persist only one message");
  const denied = await c.socket.timeout(4000).emitWithAck("message:send", { conversationId, input: { type: "text", content: "No access" } });
  assert.equal(denied.status, 404);
  let leaked = false;
  c.socket.on("message:new", () => { leaked = true; });
  const typing = once(b.socket, "typing", (p) => p.active);
  a.socket.emit("typing", { conversationId, active: true }); await typing;
  const stopped = once(b.socket, "typing", (p) => !p.active);
  a.socket.emit("typing", { conversationId, active: false }); await stopped;
  const second = await connect(member, "member");
  a.socket.disconnect(); await new Promise((r) => setTimeout(r, 50));
  assert(isOnline(member), "Closing one tab must not mark the other tab offline");
  revoked.add(second.sid);
  const revokedAck = await second.socket.timeout(4000).emitWithAck("message:send", { conversationId, input: { type: "text", content: "Revoked" } });
  assert.equal(revokedAck.status, 401);
  assert(!leaked, "Other members never receive private messages");
  console.log("PASS: real Socket.IO send/ACK, delivery receipts, immediate typing stop, isolated rooms, idempotent HTTP retry, multi-tab presence and revoked sessions (ORM simulated).");
} finally {
  sockets.forEach((s) => s.disconnect());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  saved.reverse().forEach((restore) => restore());
  await sequelize.close();
}

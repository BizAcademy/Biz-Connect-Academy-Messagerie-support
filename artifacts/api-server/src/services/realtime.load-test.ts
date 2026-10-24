/**
 * Development-only capacity smoke test. Real application + development DB.
 * No external push, no published server, no existing conversations modified.
 * Run from api-server: pnpm exec tsx src/services/realtime.load-test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import { Admin, User, Conversation, SessionRecord, MessageRecord, Presence, PushSubscription, sequelize } from "@workspace/db";
if (sequelize.getDialect() !== "postgres" || !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === "production") {
  throw new Error("Refused: this test is only allowed on the managed DEVELOPMENT PostgreSQL database.");
}
const count = 128, run = randomUUID().slice(0, 8);
const ids = Array.from({ length: count }, () => randomUUID());
const conversations = ids.map(() => randomUUID());
const sessionIds = ids.map(() => randomUUID());
const adminId = randomUUID(), adminSession = randomUUID();
const ioClient = createRequire(`${process.cwd()}/../biz-connect/package.json`)("socket.io-client").io;
const { jwtKey } = await import("../lib/config");
// Disable push exclusively in this test process. Never change shared secrets.
const originalSubscriptions = PushSubscription.findAll;
PushSubscription.findAll = async () => [];
const originalFindAll = Conversation.findAll.bind(Conversation);
Conversation.findAll = ((options: any = {}) => originalFindAll({
  ...options, where: { [Op.and]: [options.where || {}, { id: { [Op.in]: conversations } }] },
})) as typeof Conversation.findAll;
const { default: app } = await import("../app");
const { initRealtime } = await import("./realtime");
const server = createServer(app);
const sockets: any[] = [];
const expected = new Set<string>();
const received = new Set<string>();
let duplicate = 0;
const latencies: number[] = [];
const transactions = new Set<Promise<unknown>>();
const originalTransaction = sequelize.transaction.bind(sequelize);
sequelize.transaction = ((...args: any[]) => {
  const pending = (originalTransaction as any)(...args) as Promise<unknown>;
  transactions.add(pending);
  pending.then(() => transactions.delete(pending), () => transactions.delete(pending));
  return pending;
}) as typeof sequelize.transaction;
const cookie = (id: string, sid: string, role: string) => `bc_access=${jwt.sign({ sid, role }, jwtKey, { subject: id, issuer: "biz-connect", expiresIn: "15m" })}; bc_csrf=qa-load`;
let url = "";
try {
  await User.bulkCreate(ids.map((id, i) => ({ id, username: `qa_load_${run}_${i}`, phone: `+237600000${String(i).padStart(3, "0")}`, credentialHash: "not-a-login-hash", isDemo: true })));
  await Admin.create({ id: adminId, username: `qa_load_support_${run}`, phone: "", credentialHash: "not-a-login-hash", isDemo: true });
  await Conversation.bulkCreate(conversations.map((id, i) => ({ id, userId: ids[i], lastMessageAt: new Date() })));
  await SessionRecord.bulkCreate([...ids.map((id, i) => ({ id: sessionIds[i], accountId: id, role: "member", refreshHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) })),
    { id: adminSession, accountId: adminId, role: "admin", refreshHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) }]);
  await initRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  async function connect(id: string, sid: string, role: string) {
    const socket = ioClient(url, { path: "/api/socket.io", transports: ["websocket"],
      reconnection: false, auth: { csrfToken: "qa-load" }, extraHeaders: { Cookie: cookie(id, sid, role) } });
    sockets.push(socket);
    socket.on("message:new", ({ conversationId, message }: any) => {
      if (!expected.has(message.id) || message.senderRole === role) return;
      if (received.has(message.id)) duplicate++;
      received.add(message.id);
      socket.emit("message:received", { conversationId, messageId: message.id });
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Connection timed out")), 15000);
      socket.once("connect", () => { clearTimeout(t); resolve(); });
      socket.once("connect_error", (e: Error) => { clearTimeout(t); reject(e); });
    });
    return socket;
  }
  const support = await connect(adminId, adminSession, "admin");
  const members: any[] = [];
  for (let offset = 0; offset < count; offset += 32) {
    members.push(...await Promise.all(ids.slice(offset, offset + 32).map((id, n) => connect(id, sessionIds[offset + n]!, "member"))));
  }
  // Bootstrap delivery is bounded to this fixture's IDs by the test wrapper.
  await new Promise((r) => setTimeout(r, 300));
  async function send(socket: any, conversationId: string, i: number, from: string) {
    const id = randomUUID(); expected.add(id);
    const started = performance.now();
    const response = await socket.timeout(15000).emitWithAck("message:send", {
      conversationId, input: { clientMessageId: id, type: "text", content: `QA_${run} ${from} ${i}: échange simultané vers le support.` },
    });
    assert(response.ok, `Send failed: ${response.status}`);
    latencies.push(performance.now() - started);
  }
  const started = performance.now();
  for (const sends of [
    () => members.map((s, i) => send(s, conversations[i]!, i, "member")),
    () => conversations.map((id, i) => send(support, id, i, "support")),
  ]) {
    const results = await Promise.allSettled(sends());
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) throw new Error(`${failed.length} sends failed: ${(failed[0] as PromiseRejectedResult).reason?.message}`);
  }
  for (let i = 0; received.size < expected.size && i < 150; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(received.size, 256, "All 128 member sends and 128 support replies received");
  assert.equal(duplicate, 0);
  assert.equal(await MessageRecord.count({ where: { conversationId: { [Op.in]: conversations } } }), 256);
  const history = await fetch(`${url}/api/conversations/${conversations[0]}/messages`, { headers: { Cookie: cookie(ids[0]!, sessionIds[0]!, "member"), "Accept-Encoding": "gzip" } });
  assert.equal(history.status, 200);
  const body = await history.text();
  const encoded = Number(history.headers.get("content-length"));
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({
    environment: "isolated app process, real DEVELOPMENT PostgreSQL; no push or external server",
    concurrentMemberConnections: count, supportConnections: 1,
    sends: expected.size, peerReceived: received.size, duplicates: duplicate,
    totalExchangeMs: Math.round(performance.now() - started),
    sendAckP50Ms: Math.round(latencies[Math.floor(latencies.length * .5)]!),
    sendAckP95Ms: Math.round(latencies[Math.floor(latencies.length * .95)]!),
    sendAckMaxMs: Math.round(latencies.at(-1)!),
    historyBytesBeforeGzip: Buffer.byteLength(body), historyWireBytes: encoded,
    compression: history.headers.get("content-encoding"),
    memoryRssMB: Math.round(process.memoryUsage().rss / 1048576),
  }, null, 2));
} catch (error) {
  console.error("LOAD TEST FAILED:", (error as Error).message);
  throw error;
} finally {
  sockets.forEach((s) => s.disconnect());
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  // Let each fixture socket finish its last-seen update before deleting rows.
  await new Promise((r) => setTimeout(r, 1000));
  while (transactions.size) await Promise.allSettled([...transactions]);
  await MessageRecord.destroy({ where: { conversationId: { [Op.in]: conversations } } });
  await Conversation.destroy({ where: { id: { [Op.in]: conversations } } });
  await SessionRecord.destroy({ where: { id: { [Op.in]: [...sessionIds, adminSession] } } });
  await Presence.destroy({ where: { accountId: { [Op.in]: [...ids, adminId] } } });
  await Admin.destroy({ where: { id: adminId } });
  await User.destroy({ where: { id: { [Op.in]: ids } } });
  PushSubscription.findAll = originalSubscriptions;
  await sequelize.close();
}

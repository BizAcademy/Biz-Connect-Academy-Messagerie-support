// Unit regression checks: simulated ORM responses, no network/database writes.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
process.env.DATABASE_URL = "mysql://fixture:fixture@127.0.0.1:1/test";
process.env.SESSION_SECRET = "local-unit-test-secret-at-least-32-characters";
process.env.NODE_ENV = "test";
const { Admin, User, Conversation, SessionRecord, sequelize } = await import("@workspace/db");
const { loginOrCreateMember, normalizePhone } = await import("./accounts");
const { newSession, renewSession, verifyAccess, clearSessionCookies, sessionMaxAge } = await import("../middlewares/auth");
const { hashToken } = await import("../lib/config");
const original = {
  userFind: User.findAll, userCreate: User.findOrCreate, userPk: User.findByPk,
  conversation: Conversation.findOrCreate, transaction: sequelize.transaction,
  sessionCreate: SessionRecord.create, sessionFind: SessionRecord.findOne, sessionUpdate: SessionRecord.update,
  adminFind: Admin.findOne, adminPk: Admin.findByPk,
};
const accountId = "00000000-0000-4000-8000-000000000123";
let user: ReturnType<typeof User.build> | null = null;
const users: ReturnType<typeof User.build>[] = [];
let createCalls = 0, conversations = 0;
let revoked = false;
let revokeOnUpdate = false;
let stored: Record<string, any> | null = null;
let race: ReturnType<typeof User.build> | null = null;
const model = (value: Record<string, any>) => ({ get: (key?: string) => key ? value[key] : value });
const cookies = new Map<string, { value: string; options: any }>();
const res = {
  cookie(name: string, value: string, options: unknown) { cookies.set(name, { value, options }); },
  clearCookie(name: string) { cookies.delete(name); },
} as any;
try {
  User.findAll = (async (options: any) => users.filter((u) => u.get("username") === options.where.username)) as typeof User.findAll;
  User.findByPk = (async (id: unknown) => users.find((u) => u.get("id") === id) ?? null) as typeof User.findByPk;
  sequelize.transaction = (async (fn: any) => fn({})) as typeof sequelize.transaction;
  User.findOrCreate = (async (options: any) => {
    createCalls++;
    if (race) return [race, false];
    const existing = users.find((u) => u.get("username") === options.where.username && u.get("phone") === options.where.phone);
    if (existing) return [existing, false];
    user = User.build({ ...options.defaults, id: createCalls === 1 ? accountId : crypto.randomUUID() });
    users.push(user);
    return [user, true];
  }) as typeof User.findOrCreate;
  Conversation.findOrCreate = (async () => { conversations++; return [null, true]; }) as typeof Conversation.findOrCreate;
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone("+1234567890123456"), null);
  assert.deepEqual(normalizePhone("00 237 600-000-101"), { credential: "237600000101", display: "+237600000101" });
  assert.equal(await loginOrCreateMember("Fixture", "invalid"), null);
  assert.equal(createCalls, 0);
  const created = await loginOrCreateMember("Fixture", "+237 600 000 101");
  assert(created);
  assert.equal(created.get("phone"), "+237600000101");
  assert(await bcrypt.compare("237600000101", created.get("credentialHash") as string));
  assert.equal(conversations, 1);
  assert.equal((await loginOrCreateMember("Fixture", "00237600000101"))?.get("id"), accountId);
  assert.equal(createCalls, 1, "Returning members must not be recreated");
  const before = conversations;
  const different = await loginOrCreateMember("Fixture", "+237 600 000 102");
  assert(different);
  assert.notEqual(different.get("id"), accountId, "Another phone creates a separate member, not access to the original chat");
  assert.equal(created.get("phone"), "+237600000101", "Original identity is unchanged");
  assert.equal(conversations, before + 1);
  assert.equal((await loginOrCreateMember("Fixture", "+237600000101"))?.get("id"), accountId, "The old pair still restores the original identity");
  user = null;
  race = User.build({ id: accountId, username: "Fixture", credentialHash: await bcrypt.hash("237600000102", 4) });
  assert.equal(await loginOrCreateMember("RaceFixture", "+237600000101"), null, "Concurrent registration cannot claim another phone's account");
  user = created;

  SessionRecord.create = (async (data: any) => { stored = data; return model(data); }) as typeof SessionRecord.create;
  SessionRecord.findOne = (async (options: any) => {
    if (!stored || revoked) return null;
    if (options.where.refreshHash && options.where.refreshHash !== stored.refreshHash) return null;
    return model(stored);
  }) as typeof SessionRecord.findOne;
  SessionRecord.update = (async (data: any, options: any) => {
    if (revokeOnUpdate) revoked = true;
    if (revoked || !stored || options.where.refreshHash !== stored.refreshHash) return [0];
    Object.assign(stored, data);
    return [1];
  }) as typeof SessionRecord.update;
  await newSession(res, { id: accountId, role: "member" });
  assert.equal(cookies.get("bc_refresh")?.options.httpOnly, true);
  assert.equal(cookies.get("bc_refresh")?.options.maxAge, sessionMaxAge);
  assert(sessionMaxAge > 30 * 86400000);
  const token = cookies.get("bc_refresh")!.value;
  const identity = await renewSession({ cookies: { bc_refresh: token } } as any, res, false);
  assert.equal(identity?.id, accountId);
  assert.equal(cookies.get("bc_refresh")!.value, token, "Visits extend persistence without rotating across tabs");
  assert.equal((stored as any).refreshHash, hashToken(token));
  assert.equal((await verifyAccess(cookies.get("bc_access")!.value))?.id, accountId);
  assert((await renewSession({ cookies: { bc_refresh: token } } as any, res, true))?.sessionId);
  assert.notEqual(cookies.get("bc_refresh")!.value, token);
  assert.equal(await renewSession({ cookies: { bc_refresh: token } } as any, res, true), null, "Old refresh tokens cannot be replayed");
  const latestToken = cookies.get("bc_refresh")!.value;
  cookies.clear();
  revokeOnUpdate = true;
  assert.equal(await renewSession({ cookies: { bc_refresh: latestToken } } as any, res, false), null, "Logout during renewal cannot resurrect a session");
  assert.equal(cookies.size, 0, "No auth cookies issued after concurrent revocation");
  revoked = true;
  await newSession(res, { id: accountId, role: "member" });
  assert.equal(await verifyAccess(cookies.get("bc_access")!.value), null);
  assert.equal(await renewSession({ cookies: { bc_refresh: cookies.get("bc_refresh")!.value } } as any, res, false), null);
  clearSessionCookies(res);
  assert.equal(cookies.size, 0);

  // Exercise the real controller too: a client role must never elevate a member,
  // and a reserved admin name must never fall back to open member registration.
  revoked = false; revokeOnUpdate = false; race = null;
  const admin = Admin.build({
    id: "00000000-0000-4000-8000-000000000456", username: "ReservedSupport",
    credentialHash: await bcrypt.hash("fixture-support-password", 4), phone: "",
  });
  Admin.findOne = (async (options: any) => options.where.username === "ReservedSupport" ? admin : null) as typeof Admin.findOne;
  Admin.findByPk = (async () => admin) as typeof Admin.findByPk;
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { info() {}, warn() {} } as any; next(); });
  app.use((await import("../routes/auth")).default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const login = (body: object) => fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    const calls = createCalls;
    assert.equal((await login({ username: "ReservedSupport", credential: "237600000101", role: "admin" })).status, 401);
    assert.equal(createCalls, calls, "Reserved support name cannot be auto-enrolled");
    const support = await login({ username: "ReservedSupport", credential: "fixture-support-password" });
    assert.equal(support.status, 200);
    assert.equal((await support.json() as any).account.role, "admin");
    user = null;
    const member = await login({ username: "Fixture", credential: "+237600000101", role: "admin" });
    assert.equal(member.status, 200);
    assert.equal((await member.json() as any).account.role, "member");
    assert.equal((await login({ username: "  ", credential: "237600000101" })).status, 400);
    assert.equal((await login({ username: "NewFixture", credential: "abc" })).status, 400);
    assert.equal((await login({ username: "NewFixture", credential: "658706264" })).status, 400, "Country calling code is mandatory for new sessions");
    assert.equal((await login({ username: "NewFixture", credential: "00237658706264" })).status, 400, "Explicit plus country format is required");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log("PASS: member pairs, normalized phone, separate identities without overwrites, reserved support name, support conversation, persistent renewal, refresh rotation and revocation (simulated ORM).");
} finally {
  User.findAll = original.userFind; User.findOrCreate = original.userCreate; User.findByPk = original.userPk;
  Conversation.findOrCreate = original.conversation; sequelize.transaction = original.transaction;
  SessionRecord.create = original.sessionCreate; SessionRecord.findOne = original.sessionFind; SessionRecord.update = original.sessionUpdate;
  Admin.findOne = original.adminFind; Admin.findByPk = original.adminPk;
  await sequelize.close();
}

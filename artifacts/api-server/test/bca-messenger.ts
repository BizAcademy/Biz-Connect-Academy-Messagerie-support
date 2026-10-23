import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { Op } from "sequelize";
import { User, Admin, Conversation, MessageRecord, PrivateFile, SessionRecord, Presence, sequelize } from "@workspace/db";
import { removePrivate } from "../src/services/storage";

const { io } = createRequire(new URL("../../biz-connect/package.json", import.meta.url))("socket.io-client");
const base = "http://localhost:80";
const accountIds = [randomUUID(), randomUUID(), randomUUID()];
const conversationIds = [randomUUID(), randomUUID()];
const secret = randomBytes(24).toString("hex");
const prefix = `bca-test-${randomUUID()}`;
const sockets: any[] = [];
function client() {
  let cookie = "", csrf = "";
  return {
    get cookie() { return cookie; }, get csrf() { return csrf; },
    async call(path: string, body?: any, method = body === undefined ? "GET" : "POST") {
      const form = body instanceof FormData;
      const response = await fetch(base + "/api" + path, {
        method, headers: { cookie, "x-csrf-token": csrf, ...(!form ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
      for (const c of response.headers.getSetCookie()) {
        const pair = c.split(";")[0]!, name = pair.split("=")[0]!;
        cookie = cookie.split("; ").filter((v) => !v.startsWith(name + "=")).concat(pair).join("; ");
      }
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    },
  };
}
async function poll(check: () => Promise<boolean>) {
  for (let i = 0; i < 30; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Timed out waiting for receipt");
}
async function connect(api: ReturnType<typeof client>) {
  const socket = io(base, { path: "/api/socket.io", transports: ["websocket"], auth: { csrfToken: api.csrf },
    extraHeaders: { Cookie: api.cookie }, reconnection: false, timeout: 5000 });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
}
async function main() {
  const credentialHash = await bcrypt.hash(secret, 10);
  await Admin.create({ id: accountIds[0], username: prefix + "-support", credentialHash });
  await User.bulkCreate([1, 2].map((i) => ({ id: accountIds[i], username: prefix + "-" + i, credentialHash })));
  await Conversation.bulkCreate([1, 2].map((i) => ({ id: conversationIds[i - 1], userId: accountIds[i] })));
  const admin = client(), member = client(), other = client();
  for (const api of [admin, member, other]) await api.call("/auth/session");
  const supportLogin = await admin.call("/auth/login", { username: prefix + "-support", credential: secret });
  assert.equal(supportLogin.status, 200); assert.equal(supportLogin.data.account.role, "admin");
  const memberLogin = await member.call("/auth/login", { username: prefix + "-1", credential: secret, role: "admin" });
  assert.equal(memberLogin.status, 200); assert.equal(memberLogin.data.account.role, "member", "Client cannot elevate own role");
  assert.equal((await other.call("/auth/login", { username: prefix + "-2", credential: secret })).status, 200);
  assert.equal((await admin.call("/auth/demo", { role: "admin" })).status, 400, "Admin demo disabled");
  assert.equal((await member.call("/conversations")).data.length, 1);
  const path = `/conversations/${conversationIds[0]}`;
  assert.equal((await other.call(path + "/messages", { type: "text", content: "forbidden" })).status, 404);
  assert.equal((await member.call(`/conversations/${conversationIds[1]}/messages`)).status, 404);
  const sent = await member.call(path + "/messages", { type: "text", content: "Receipt test" });
  assert.equal(sent.status, 201); assert.equal(sent.data.status, "sent");
  await connect(admin);
  const getMessage = async (api: ReturnType<typeof client>, id: string) =>
    (await api.call(path + "/messages")).data.find((m: any) => m.id === id);
  await poll(async () => (await getMessage(member, sent.data.id)).status === "delivered");
  assert.equal((await getMessage(member, sent.data.id)).status, "delivered", "Receiving does not read the message");
  assert((await admin.call("/conversations")).data.some((c: any) => c.id === conversationIds[0]), "Support receives member conversation");
  await admin.call(path + "/read", {});
  assert.equal((await getMessage(member, sent.data.id)).status, "read");
  const reply = await admin.call(path + "/messages", { type: "text", content: "Support reply" });
  assert.equal(reply.data.status, "sent", "Member is offline");
  await connect(member);
  await poll(async () => (await getMessage(admin, reply.data.id)).status === "delivered");
  await member.call(path + "/read", {});
  assert.equal((await getMessage(admin, reply.data.id)).status, "read");
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#D4AF37" } }).png().toBuffer();
  for (const [api, expectedId] of [[admin, accountIds[0]], [member, accountIds[1]]] as const) {
    const form = new FormData(); form.append("purpose", "avatar");
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "avatar.png");
    const upload = await api.call("/files", form);
    assert.equal(upload.status, 201);
    assert.equal((await api.call("/profile", { avatarFileId: upload.data.id }, "PATCH")).status, 200);
    const message = await api.call(path + "/messages", { type: "text", content: "Avatar check" });
    assert.equal(message.data.senderId, expectedId);
    assert.equal(message.data.senderAvatarUrl, upload.data.url);
    assert.equal(typeof message.data.senderName, "string");
    const recipient = api === admin ? member : admin;
    assert.equal((await getMessage(recipient, message.data.id)).senderAvatarUrl, upload.data.url);
    const image = await fetch(base + upload.data.url, { headers: { cookie: recipient.cookie } });
    assert.equal(image.status, 200, "Recipient can access the sender's protected avatar");
  }
  console.log("PASS: database-selected admin login, role injection blocked, admin demo disabled, support-only conversations, offline/delivered/read in both directions, sender profile photos.");
}
try { await main(); }
finally {
  for (const socket of sockets) socket.disconnect();
  await new Promise((r) => setTimeout(r, 100));
  const files = await PrivateFile.findAll({ where: { ownerId: { [Op.in]: accountIds } } });
  await MessageRecord.destroy({ where: { conversationId: { [Op.in]: conversationIds } } });
  await User.update({ avatarFileId: null }, { where: { id: { [Op.in]: accountIds } } });
  await Admin.update({ avatarFileId: null }, { where: { id: { [Op.in]: accountIds } } });
  for (const f of files) { await removePrivate(f.get("path") as string); await f.destroy(); }
  await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } } });
  await SessionRecord.destroy({ where: { accountId: { [Op.in]: accountIds } } });
  await Presence.destroy({ where: { accountId: { [Op.in]: accountIds } } });
  await User.destroy({ where: { id: { [Op.in]: accountIds } } });
  await Admin.destroy({ where: { id: { [Op.in]: accountIds } } });
  await sequelize.close();
}

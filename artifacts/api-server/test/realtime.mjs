import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { client, base } from "./helpers.mjs";
const { io } = createRequire(new URL("../../biz-connect/package.json", import.meta.url))("socket.io-client");
const member = await client("member"), admin = await client("admin");
const id = (await member.call("/conversations")).data[0].id;
const connect = (api) => io(base, { path: "/api/socket.io", transports: ["websocket"], auth: { csrfToken: api.csrf }, extraHeaders: { Cookie: api.cookie }, reconnection: false, timeout: 5000 });
const a = connect(admin), m = connect(member);
const timeout = (socket, event) => Promise.race([once(socket, event), new Promise((_, reject) => setTimeout(() => reject(new Error(event + " timed out")), 6000))]);
try {
  await Promise.all([timeout(a, "connect"), timeout(m, "connect")]);
  assert.equal((await member.call("/conversations")).data[0].online, true);
  const typing = timeout(a, "typing");
  m.emit("typing", { conversationId: id, active: true });
  assert.equal((await typing)[0].conversationId, id);
  const changed = timeout(a, "changed");
  const result = await member.call(`/conversations/${id}/messages`, { type: "text", content: "Vérification technique : Socket.IO, présence et saisie." });
  assert.equal(result.status, 201);
  assert.equal((await changed)[0].conversationId, id);
  console.log("REALTIME PASS: authenticated WebSocket, support presence, typing, new-message event");
  console.log("cleanupMessageId=" + result.data.id);
} finally { a.disconnect(); m.disconnect(); }

import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import type { Message } from "@workspace/api-client-react";
import { appendRealtimeMessage, applyReceipt, mapRealtimeMessages, type History } from "./realtime-cache";
const qc = new QueryClient();
const message: Message = {
  id: "fixture", conversationId: "conversation", senderId: "member", senderRole: "member",
  senderName: "Fixture", senderAvatarUrl: null, type: "text", content: "Bonjour",
  fileUrl: null, duration: null, status: "sent", createdAt: "2026-01-01T00:00:00.000Z",
};
const key = ["chat-history", message.conversationId];
qc.setQueryData<History>(key, { pages: [{ messages: [], cursor: "older" }], pageParams: [""] });
appendRealtimeMessage(qc, message);
applyReceipt(qc, { conversationId: message.conversationId, messageId: message.id, status: "read" });
appendRealtimeMessage(qc, message); // delayed HTTP/Socket ACK must not downgrade “read”
const history = qc.getQueryData<History>(key)!;
assert.equal(history.pages[0]!.messages.length, 1);
assert.equal(history.pages[0]!.messages[0]!.status, "read");
assert.equal(history.pages[0]!.cursor, "older");
applyReceipt(qc, { conversationId: message.conversationId, status: "delivered", senderRole: "admin" });
assert.equal(qc.getQueryData<History>(key)!.pages[0]!.messages[0]!.status, "read");
mapRealtimeMessages(qc, message.conversationId, () => null);
assert.equal(qc.getQueryData<History>(key)!.pages[0]!.messages.length, 0);
qc.clear();
console.log("PASS: realtime cache inserts without duplicates, monotonic receipts, older cursors preserved and direct deletion.");

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { getGetMessagesQueryKey, type Message } from "@workspace/api-client-react";

export type History = InfiniteData<{ messages: Message[]; cursor: string }>;
const rank = { sent: 0, delivered: 1, read: 2 };
export function mergeMessage(previous: Message, incoming: Message): Message {
  return { ...incoming, status: rank[previous.status] > rank[incoming.status] ? previous.status : incoming.status };
}
export function appendRealtimeMessage(qc: QueryClient, message: Message) {
  qc.setQueryData<History>(["chat-history", message.conversationId], (old) => {
    if (!old?.pages.length) return old;
    const exists = old.pages.some((page) => page.messages.some((m) => m.id === message.id));
    return { ...old, pages: old.pages.map((page, i) => ({
      ...page, messages: exists ? page.messages.map((m) => m.id === message.id ? mergeMessage(m, message) : m)
        : i === 0 ? [...page.messages, message].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id)) : page.messages,
    })) };
  });
  qc.setQueryData<Message[]>(getGetMessagesQueryKey(message.conversationId), (old) => old
    ? old.some((m) => m.id === message.id) ? old.map((m) => m.id === message.id ? mergeMessage(m, message) : m) : [...old, message]
    : old);
}
export function mapRealtimeMessages(qc: QueryClient, conversationId: string, update: (m: Message) => Message | null) {
  const map = (messages: Message[]) => messages.flatMap((m) => { const next = update(m); return next ? [next] : []; });
  qc.setQueryData<History>(["chat-history", conversationId], (old) => old ? { ...old, pages: old.pages.map((p) => ({ ...p, messages: map(p.messages) })) } : old);
  qc.setQueryData<Message[]>(getGetMessagesQueryKey(conversationId), (old) => old ? map(old) : old);
}
export function applyReceipt(qc: QueryClient, receipt: { conversationId: string; messageId?: string; senderRole?: string; before?: string; status: Message["status"] }) {
  mapRealtimeMessages(qc, receipt.conversationId, (m) =>
    (!receipt.messageId || m.id === receipt.messageId) && (!receipt.senderRole || m.senderRole === receipt.senderRole)
      && (!receipt.before || new Date(m.createdAt).getTime() <= new Date(receipt.before).getTime())
      && rank[receipt.status] > rank[m.status] ? { ...m, status: receipt.status } : m);
}

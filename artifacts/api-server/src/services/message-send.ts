import { randomUUID } from "node:crypto";
import { MessageRecord, PrivateFile, sequelize } from "@workspace/db";
import { SendMessageBody, SendMessageResponse } from "@workspace/api-zod";
import type { Identity } from "./accounts";
import { authorizeConversation, serializeMessages } from "./conversations";
import { emitNewMessage } from "./realtime";
import { sendMessagePush } from "./push";
import { logger } from "../lib/logger";

export class MessageSendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** HTTP and Socket.IO share validation, authorization and idempotent persistence. */
export async function persistMessage(identity: Identity, conversationId: string, input: unknown) {
  const c = await authorizeConversation(conversationId, identity);
  if (!c) throw new MessageSendError(404, "Conversation introuvable.");
  const parsed = SendMessageBody.safeParse(input);
  if (!parsed.success) throw new MessageSendError(400, "Message invalide (10 000 caractères maximum).");
  const data = parsed.data;
  const id = data.clientMessageId || randomUUID();
  const existing = async () => {
    const row = await MessageRecord.findByPk(id);
    if (!row) return null;
    if (row.get("senderId") !== identity.id || row.get("senderRole") !== identity.role || row.get("conversationId") !== conversationId) {
      throw new MessageSendError(409, "Identifiant de message déjà utilisé.");
    }
    const [message] = await serializeMessages([row]);
    return SendMessageResponse.parse(message);
  };
  if (data.clientMessageId) {
    const previous = await existing();
    if (previous) return previous;
  }
  if (data.type === "text" && !data.content?.trim()) throw new MessageSendError(400, "Le message est vide.");
  if (data.replyToId && !await MessageRecord.findOne({ where: { id: data.replyToId, conversationId } })) {
    throw new MessageSendError(400, "Le message cité n’existe plus dans cette conversation.");
  }
  const file = data.type === "text" ? null : await PrivateFile.findOne({ where: {
    id: data.fileId || null, ownerId: identity.id, conversationId, purpose: data.type,
  } });
  if (data.type !== "text" && !file) throw new MessageSendError(400, "Pièce jointe invalide.");
  let created;
  try {
    created = await sequelize.transaction(async (transaction) => {
      const row = await MessageRecord.create({
        id, conversationId, senderId: identity.id, senderRole: identity.role,
        type: data.type, content: data.content?.trim() || "", fileId: file?.get("id") || null,
        duration: data.type === "voice" ? file?.get("duration") : null,
        status: "sent", isRead: false, createdAt: new Date(),
        replyToId: data.replyToId || null, hiddenFor: "[]",
      }, { transaction });
      await c.update({ lastMessageAt: new Date() }, { transaction });
      return row;
    });
  } catch (error) {
    // A timed-out socket ACK and HTTP fallback may race. The primary key
    // guarantees one message, one push and one last-message update.
    if (data.clientMessageId && (error as Error).name === "SequelizeUniqueConstraintError") {
      const previous = await existing();
      if (previous) return previous;
    }
    throw error;
  }
  const [serialized] = await serializeMessages([created]);
  const message = SendMessageResponse.parse(serialized);
  emitNewMessage(conversationId, String(c.get("userId")), message);
  void sendMessagePush(identity, String(c.get("userId")), message).catch((err) => logger.warn({ err }, "Push failed"));
  return message;
}

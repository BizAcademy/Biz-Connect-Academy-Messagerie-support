import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMessagesQueryKey,
  getGetSessionQueryKey,
  getGetSummaryQueryKey,
  useRefreshSession,
  sendMessage as sendHttpMessage,
  type Account,
  type Message,
  type MessageInput,
  type Conversation,
} from "@workspace/api-client-react";
import { getCsrfToken, setCsrfToken } from "@/lib/api-fetch";
import { appendRealtimeMessage, applyReceipt, mapRealtimeMessages, type History } from "@/lib/realtime-cache";

type Status = "connecting" | "online" | "offline";
type Ctx = {
  status: Status;
  typing: Record<string, boolean>;
  emitTyping: (conversationId: string, active: boolean) => void;
  sendRealtimeMessage: (conversationId: string, data: MessageInput, signal?: AbortSignal) => Promise<Message>;
};
const RealtimeCtx = createContext<Ctx>({ status: "offline", typing: {}, emitTyping: () => undefined, sendRealtimeMessage: (id, data, signal) => sendHttpMessage(id, data, { signal }) });
export const useRealtime = () => useContext(RealtimeCtx);

const isListKey = (k: readonly unknown[]) => k[0] === "/api/conversations";

export function RealtimeProvider({ account, children }: { account: Account; children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("connecting");
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const socketRef = useRef<Socket | null>(null);
  const outgoingTyping = useRef(new Map<string, number>());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useRefreshSession();
  const refreshRef = useRef(refresh.mutateAsync);
  refreshRef.current = refresh.mutateAsync;

  useEffect(() => {
    let disposed = false;
    setTyping({});
    const socket = io({
      path: "/api/socket.io",
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
      auth: (cb) => cb({ csrfToken: getCsrfToken() }),
    });
    socketRef.current = socket;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const sources = new Map<string, Set<string>>();
    const lastEmitted = outgoingTyping.current;
    lastEmitted.clear();
    const clearTyping = () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {}; sources.clear(); setTyping({});
    };

    const invalidateLists = () => {
      if (listTimer) return;
      listTimer = setTimeout(() => {
        listTimer = undefined;
        void qc.invalidateQueries({ predicate: (q) => isListKey(q.queryKey) });
        void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
      }, 250);
    };

    socket.on("connect", () => {
      void qc.invalidateQueries({ queryKey: ["chat-history"] });
      setStatus("online");
      // recover anything missed while disconnected
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/conversations"),
      });
    });
    socket.on("disconnect", (reason) => {
      setStatus("offline"); clearTyping();
      if (reason === "io server disconnect") {
        retry = setTimeout(() => { if (!disposed) socket.connect(); }, 2000);
      }
    });
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    socket.on("connect_error", () => {
      setStatus("offline");
      if (socket.active) return; // transport error: socket.io retries by itself
      if (retry) clearTimeout(retry);
      retry = setTimeout(async () => {
        if (disposed) return;
        try {
          const s = await refreshRef.current();
          setCsrfToken(s.csrfToken);
          qc.setQueryData(getGetSessionQueryKey(), s);
          if (s.account && !disposed) socket.connect();
        } catch {
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        }
      }, 2500);
    });

    socket.on("changed", (p?: { conversationId?: string; realtimeVersion?: number }) => {
      if (p?.realtimeVersion === 2) return; // compatibility event for older open tabs
      void qc.invalidateQueries({ queryKey: p?.conversationId ? ["chat-history", p.conversationId] : ["chat-history"] });
      invalidateLists();
      if (p?.conversationId) void qc.invalidateQueries({ queryKey: getGetMessagesQueryKey(p.conversationId) });
      else
        void qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === "string" && /\/messages$/.test(q.queryKey[0] as string),
        });
    });
    socket.on("message:new", (p: { conversationId: string; message: Message }) => {
      if (!p?.message?.id || p.message.conversationId !== p.conversationId) return;
      appendRealtimeMessage(qc, p.message);
      if (p.message.senderRole !== account.role) {
        socket.emit("message:received", { conversationId: p.conversationId, messageId: p.message.id });
      }
      invalidateLists();
    });
    socket.on("messages:status", (p: Parameters<typeof applyReceipt>[1]) => {
      if (!p?.conversationId || !["sent", "delivered", "read"].includes(p.status)) return;
      applyReceipt(qc, p); invalidateLists();
    });
    socket.on("message:deleted", (p: { conversationId: string; messageId: string; global?: boolean }) => {
      if (!p?.conversationId || !p.messageId) return;
      const history = qc.getQueryData<History>(["chat-history", p.conversationId]);
      mapRealtimeMessages(qc, p.conversationId, (m) => m.id === p.messageId ? null : p.global && m.replyTo?.id === p.messageId ? { ...m, replyTo: null } : m);
      if (history?.pages.some((page) => page.cursor === p.messageId)) void qc.invalidateQueries({ queryKey: ["chat-history", p.conversationId] });
      invalidateLists();
    });
    socket.on("presence", (p: { accountId: string; role: string; online: boolean; lastSeen: string }) => {
      if (account.role !== "admin" || p?.role !== "member") return;
      qc.setQueriesData<Conversation[]>({ predicate: (q) => isListKey(q.queryKey) }, (old) =>
        old?.map((c) => c.userId === p.accountId ? { ...c, online: p.online, lastSeen: p.lastSeen } : c));
      invalidateLists();
    });
    socket.on("support:presence", (p: { online: boolean; lastSeen: string | null }) => {
      if (account.role !== "member" || typeof p?.online !== "boolean") return;
      qc.setQueriesData<Conversation[]>({ predicate: (q) => isListKey(q.queryKey) }, (old) =>
        old?.map((c) => ({ ...c, online: p.online, lastSeen: p.lastSeen || c.lastSeen })));
    });
    socket.on("typing", (p: { conversationId: string; role: string; source?: string; active: boolean }) => {
      if (!p || p.role === account.role) return;
      const source = p.source || p.role, key = `${p.conversationId}:${source}`;
      const active = sources.get(p.conversationId) || new Set<string>();
      sources.set(p.conversationId, active);
      clearTimeout(timers.current[key]);
      if (p.active) active.add(source); else active.delete(source);
      setTyping((t) => ({ ...t, [p.conversationId]: active.size > 0 }));
      if (p.active) timers.current[key] = setTimeout(() => {
        active.delete(source); delete timers.current[key];
        setTyping((t) => ({ ...t, [p.conversationId]: active.size > 0 }));
      }, 6000);
    });

    const online = () => !socket.connected && socket.connect();
    window.addEventListener("online", online);
    const vis = () => {
      if (document.visibilityState === "visible") online();
      else {
        for (const id of lastEmitted.keys()) socket.volatile.emit("typing", { conversationId: id, active: false });
        lastEmitted.clear();
      }
    };
    document.addEventListener("visibilitychange", vis);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      clearTimeout(listTimer); clearTyping();
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", vis);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [account.id, account.role, qc]);

  const emitTyping = useCallback((conversationId: string, active: boolean) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const last = outgoingTyping.current;
    if (active && Date.now() - (last.get(conversationId) || 0) < 1000) return;
    if (active) last.set(conversationId, Date.now()); else last.delete(conversationId);
    socket.volatile.emit("typing", { conversationId, active });
  }, []);

  const sendRealtimeMessage = useCallback(async (conversationId: string, data: MessageInput, signal?: AbortSignal) => {
    const input = { ...data, clientMessageId: data.clientMessageId || crypto.randomUUID() };
    signal?.throwIfAborted();
    const socket = socketRef.current;
    if (socket?.connected) {
      let response: { ok: boolean; message?: Message; status?: number; error?: string } | undefined;
      try { response = await socket.timeout(8000).emitWithAck("message:send", { conversationId, input }); }
      catch { /* Lost ACK/transport: retry the SAME identifier over HTTP. */ }
      signal?.throwIfAborted();
      if (response?.ok && response.message) return response.message;
      if (response && response.status !== 401) throw Object.assign(new Error(response.error || "Envoi impossible."), { status: response.status, data: { error: response.error } });
    }
    return sendHttpMessage(conversationId, input, { signal });
  }, []);

  return <RealtimeCtx.Provider value={{ status, typing, emitTyping, sendRealtimeMessage }}>{children}</RealtimeCtx.Provider>;
}

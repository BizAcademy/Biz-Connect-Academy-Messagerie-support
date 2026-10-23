import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMessagesQueryKey,
  getGetSessionQueryKey,
  getGetSummaryQueryKey,
  useRefreshSession,
  type Account,
} from "@workspace/api-client-react";
import { getCsrfToken, setCsrfToken } from "@/lib/api-fetch";

type Status = "connecting" | "online" | "offline";
type Ctx = {
  status: Status;
  typing: Record<string, boolean>;
  emitTyping: (conversationId: string, active: boolean) => void;
};
const RealtimeCtx = createContext<Ctx>({ status: "offline", typing: {}, emitTyping: () => undefined });
export const useRealtime = () => useContext(RealtimeCtx);

const isListKey = (k: readonly unknown[]) => k[0] === "/api/conversations";

export function RealtimeProvider({ account, children }: { account: Account; children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("connecting");
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const socketRef = useRef<Socket | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useRefreshSession();
  const refreshRef = useRef(refresh.mutateAsync);
  refreshRef.current = refresh.mutateAsync;

  useEffect(() => {
    const socket = io({
      path: "/api/socket.io",
      withCredentials: true,
      auth: (cb) => cb({ csrfToken: getCsrfToken() }),
    });
    socketRef.current = socket;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const invalidateLists = () => {
      void qc.invalidateQueries({ predicate: (q) => isListKey(q.queryKey) });
      void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    };

    socket.on("connect", () => {
      setStatus("online");
      // recover anything missed while disconnected
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/conversations"),
      });
    });
    socket.on("disconnect", () => setStatus("offline"));
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    socket.on("connect_error", () => {
      setStatus("offline");
      if (socket.active) return; // transport error: socket.io retries by itself
      retry = setTimeout(async () => {
        try {
          const s = await refreshRef.current();
          setCsrfToken(s.csrfToken);
          qc.setQueryData(getGetSessionQueryKey(), s);
          if (s.account) socket.connect();
        } catch {
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        }
      }, 2500);
    });

    socket.on("changed", (p?: { conversationId?: string }) => {
      invalidateLists();
      if (p?.conversationId) void qc.invalidateQueries({ queryKey: getGetMessagesQueryKey(p.conversationId) });
      else
        void qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === "string" && /\/messages$/.test(q.queryKey[0] as string),
        });
    });
    socket.on("presence", () => invalidateLists());
    socket.on("typing", (p: { conversationId: string; role: string; active: boolean }) => {
      if (!p || p.role === account.role) return;
      clearTimeout(timers.current[p.conversationId]);
      setTyping((t) => ({ ...t, [p.conversationId]: p.active }));
      if (p.active)
        timers.current[p.conversationId] = setTimeout(
          () => setTyping((t) => ({ ...t, [p.conversationId]: false })),
          6000,
        );
    });

    const online = () => !socket.connected && socket.connect();
    window.addEventListener("online", online);
    const vis = () => document.visibilityState === "visible" && online();
    document.addEventListener("visibilitychange", vis);

    return () => {
      if (retry) clearTimeout(retry);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", vis);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [account.id, account.role, qc]);

  const emitTyping = useCallback((conversationId: string, active: boolean) => {
    socketRef.current?.connected && socketRef.current.emit("typing", { conversationId, active });
  }, []);

  return <RealtimeCtx.Provider value={{ status, typing, emitTyping }}>{children}</RealtimeCtx.Provider>;
}

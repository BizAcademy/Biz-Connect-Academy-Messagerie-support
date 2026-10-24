import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, CheckCheck, ChevronDown, Copy, MoreHorizontal, Reply, RotateCw, Trash2 } from "lucide-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetSummaryQueryKey,
  deleteMessage,
  useMarkRead,
  type Message,
} from "@workspace/api-client-react";
import { formatDayLabel, formatTime, linkify } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/components/realtime";
import { AudioPlayer, ImageThumb, ImageViewer, UserAvatar } from "./media";
import { Composer } from "./composer";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { mapRealtimeMessages } from "@/lib/realtime-cache";

function Ticks({ status }: { status: Message["status"] }) {
  if (status === "sent") return <Check aria-label="Envoyé, pas encore reçu" className="h-3.5 w-3.5 text-white" data-testid="status-sent" />;
  return (
    <CheckCheck
      aria-label={status === "read" ? "Lu" : "Reçu, pas encore lu"}
      className={cn("h-3.5 w-3.5", status === "read" ? "text-[#D4AF37]" : "text-white")}
      data-testid={`status-${status}`}
    />
  );
}

const SWIPE_TRIGGER = 60;
const SWIPE_MAX = 84;

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function Bubble({
  m,
  mine,
  tail,
  highlight,
  onOpenImage,
  onReply,
  onMenu,
  onQuote,
}: {
  m: Message;
  mine: boolean;
  tail: boolean;
  highlight: boolean;
  onOpenImage: (url: string, blob: Blob) => void;
  onReply: () => void;
  onMenu: () => void;
  onQuote: (id: string) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; axis: "x" | "y" | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const row = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const suppressClick = useRef(false);
  const paint = (dx: number, animate: boolean) => {
      const el = row.current;
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.style.animation = "none";
      el.style.transition = animate && !reduce ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "none";
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : "";
      if (hint.current) hint.current.style.opacity = String(Math.min(1, -dx / SWIPE_TRIGGER));
  };
  const finish = (commit: boolean) => {
    clearTimeout(timer.current);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (commit && g.axis === "x" && g.dx <= -SWIPE_TRIGGER) {
      suppressClick.current = true;
      onReply();
      navigator.vibrate?.(10);
    }
    if (g.axis === "x") paint(0, true);
  };
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const meta = (
    <span className="ml-2 inline-flex translate-y-1 items-center gap-1 whitespace-nowrap align-bottom text-[10.5px] font-medium text-white/75">
      {formatTime(m.createdAt)}
      {mine && <Ticks status={m.status} />}
    </span>
  );
  return (
    <div className="relative anim-bubble" data-message-row={m.id} data-highlighted={highlight ? "true" : undefined}>
    <span ref={hint} aria-hidden className="pointer-events-none absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-primary opacity-0 shadow-sm">
      <Reply className="h-4 w-4" />
    </span>
    <div
      ref={row}
      className={cn(
        "group relative flex touch-pan-y select-none rounded-2xl transition-colors duration-700 [-webkit-touch-callout:none] motion-reduce:transition-none",
        mine ? "justify-end" : "justify-start",
        tail ? "mb-2" : "mb-0.5",
        highlight && "bg-[#D4AF37]/25 duration-200",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("audio,input,textarea,[data-message-menu],[data-testid='audio-player']")) return;
        suppressClick.current = false;
        gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, axis: null };
        timer.current = setTimeout(() => { suppressClick.current = true; finish(false); onMenu(); navigator.vibrate?.(8); }, 550);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.axis) {
          if (Math.hypot(dx, dy) < 8) return;
          clearTimeout(timer.current);
          g.axis = Math.abs(dx) > Math.abs(dy) && dx < 0 ? "x" : "y";
          if (g.axis === "y") { gesture.current = null; return; } // leave vertical scroll to the browser
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        // Rubber band beyond the cap so the bubble keeps following without running away.
        const raw = Math.min(0, dx);
        g.dx = raw < -SWIPE_MAX ? -SWIPE_MAX - (-raw - SWIPE_MAX) * 0.2 : raw;
        paint(g.dx, false);
      }}
      onPointerUp={(e) => { if (gesture.current?.id === e.pointerId) finish(true); }}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={(e) => { if (gesture.current?.id === e.pointerId) finish(false); }}
      onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}
      onContextMenu={(e) => { e.preventDefault(); finish(false); onMenu(); }}
      data-testid={`message-${m.id}`}>
      {!mine && (
        <div className="mr-2 mt-1 shrink-0" data-testid={`sender-avatar-${m.id}`} title={m.senderName}>
          <UserAvatar name={m.senderName} src={m.senderAvatarUrl} size={30} />
        </div>
      )}
      <div
        className={cn(
          "relative max-w-[82%] px-3 py-1.5 text-[15px] leading-[1.4] text-white shadow-[0_1px_1px_rgba(11,27,63,0.12)] sm:max-w-[68%]",
          mine ? "bg-out" : "bg-in",
          tail ? (mine ? "bubble-out" : "bubble-in") : "rounded-[18px]",
          m.type === "image" && "grid w-fit min-w-0 max-w-none overflow-hidden p-1 sm:max-w-none",
          highlight && "outline outline-2 outline-[#D4AF37]/60 shadow-[0_0_0_4px_rgba(212,175,55,0.12)]",
        )}
      >
        <button data-message-menu type="button" aria-label="Actions du message" onClick={onMenu} className="absolute right-1 top-1 z-10 rounded-full bg-black/30 p-1 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>
        {m.replyTo && <button type="button" onClick={() => onQuote(m.replyTo!.id)} aria-label={`Aller au message de ${m.replyTo.senderName}`} className={cn("mb-1 block min-w-0 rounded-lg border-l-4 border-[#BDA8FA] bg-black/15 px-2 py-1.5 text-left text-sm transition-colors hover:bg-black/25", m.type === "image" ? "w-0 min-w-full" : "w-full")} data-testid="quoted-message"><p className="font-semibold text-[#E6DDFF]">{m.replyTo.senderName}</p><p className="line-clamp-3 whitespace-pre-wrap break-words text-white/75">{m.replyTo.content}</p></button>}
        {m.type === "image" && m.fileUrl && (
          <div className="relative">
            <ImageThumb src={m.fileUrl} onOpen={onOpenImage} />
            {!m.content && (
              <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10.5px] text-white">
                {formatTime(m.createdAt)}
                {mine && <Ticks status={m.status} />}
              </span>
            )}
          </div>
        )}
        {m.type === "voice" && m.fileUrl && (
          <div className="flex items-end">
            <AudioPlayer src={m.fileUrl} duration={m.duration} mine={mine} />
            {meta}
          </div>
        )}
        {m.type !== "voice" && (m.type === "text" || m.content) && (
          <p className={cn("whitespace-pre-wrap break-words", m.type === "image" && "w-0 min-w-full px-2 pb-1 pt-1.5")}>
            {linkify(m.content)}
            {meta}
          </p>
        )}
      </div>
    </div>
    </div>
  );
}

export function ChatView({
  conversationId,
  myRole,
  header,
  emptyHint,
  unreadCount,
}: {
  conversationId: string;
  myRole: "member" | "admin";
  header: ReactNode;
  emptyHint: ReactNode;
  unreadCount: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setReplyTo(null); setSelected(null); }, [conversationId]);
  const { status, typing } = useRealtime();
  const [anchor, setAnchor] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const pendingJump = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setAnchor(null); pendingJump.current = null; }, [conversationId]);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  const msgs = useInfiniteQuery({
      queryKey: ["chat-history", conversationId, ...(anchor ? [anchor] : [])],
      initialPageParam: "",
      queryFn: async ({ pageParam, signal }) => {
        const qs = pageParam ? `?before=${encodeURIComponent(pageParam)}` : anchor ? `?around=${encodeURIComponent(anchor)}` : "";
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages${qs}`, { signal, credentials: "include" });
        if (!response.ok) throw new Error("Historique indisponible");
        return { messages: await response.json() as Message[], cursor: response.headers.get("X-History-Cursor") || "" };
      },
      getNextPageParam: (page) => page.cursor || undefined,
      staleTime: 15_000,
      refetchInterval: status === "online" || anchor ? false : 12_000,
      retry: anchor ? false : 3,
  });
  const markRead = useMarkRead();
  const markRef = useRef(markRead.mutate);
  markRef.current = markRead.mutate;
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [viewer, setViewer] = useState<{ url: string; blob: Blob } | null>(null);
  const messages = useMemo(() => {
    const all = msgs.data?.pages.slice().reverse().flatMap((p) => p.messages) ?? [];
    return [...new Map(all.map((m) => [m.id, m])).values()];
  }, [msgs.data]);
  const flash = (id: string) => {
    const el = scroller.current?.querySelector(`[data-message-row="${CSS.escape(id)}"]`);
    if (!el) return false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    clearTimeout(highlightTimer.current);
    setHighlightId(id);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 3000);
    return true;
  };
  const jumpTo = (id: string) => {
    if (flash(id)) return;
    if (pendingJump.current) return;
    pendingJump.current = id;
    firstLoad.current = false;
    setAnchor(id);
  };
  const leaveAnchor = () => {
    pendingJump.current = null;
    firstLoad.current = true;
    setAnchor(null);
  };
  useEffect(() => {
    const id = pendingJump.current;
    if (!id || !anchor) return;
    if (msgs.isError) {
      pendingJump.current = null;
      setAnchor(null);
      toast({ title: "Message original indisponible", description: "Il a peut-être été supprimé." });
      return;
    }
    if (!msgs.isSuccess || msgs.isFetching) return;
    pendingJump.current = null;
    requestAnimationFrame(() => {
      if (!flash(id)) {
        setAnchor(null);
        firstLoad.current = true;
        toast({ title: "Message original indisponible", description: "Il a peut-être été supprimé." });
      }
    });
  }, [anchor, msgs.isSuccess, msgs.isError, msgs.isFetching, msgs.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const copySelected = async () => {
    const text = selected?.content;
    if (!text) return;
    const ok = await copyText(text);
    toast(ok ? { title: "Texte copié" } : { title: "Copie impossible", description: "Votre navigateur a bloqué l'accès au presse-papiers.", variant: "destructive" });
    if (ok) setSelected(null);
  };
  const remove = async (scope: "me" | "everyone") => {
    if (!selected || deleting) return;
    if (!window.confirm(scope === "everyone" ? "Supprimer ce message pour tout le monde ? Cette action est définitive." : "Supprimer ce message uniquement pour vous ?")) return;
    setDeleting(true);
    try {
      await deleteMessage(conversationId, selected.id, { scope });
      if (replyTo?.id === selected.id) setReplyTo(null);
      setSelected(null);
      await qc.invalidateQueries({ queryKey: ["chat-history", conversationId] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/conversations" });
    } catch (e) { toast({ title: "Suppression impossible", description: errorMessage(e), variant: "destructive" }); }
    finally { setDeleting(false); }
  };
  const otherTyping = !!typing[conversationId];

  // unread incoming
  const lastIncomingUnread = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.senderRole !== myRole && m.status !== "read") return m.id;
    }
    return null;
  }, [messages, myRole]);
  const pendingRead = lastIncomingUnread ?? (unreadCount > 0 ? `u${unreadCount}` : null);
  const markedFor = useRef<string | null>(null);

  useEffect(() => {
    const attempt = () => {
      if (anchor) return; // Reading old context must not mark unseen new messages read.
      if (!pendingRead || document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (markedFor.current === `${conversationId}:${pendingRead}`) return;
      markedFor.current = `${conversationId}:${pendingRead}`;
      const visibleIds = new Set(messages.filter((m) => m.senderRole !== myRole).map((m) => m.id));
      markRef.current(
        { id: conversationId },
        {
          onSuccess: () => {
            void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/conversations" });
            void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
            mapRealtimeMessages(qc, conversationId, (m) => visibleIds.has(m.id) ? { ...m, status: "read" } : m);
          },
          onError: () => {
            markedFor.current = null;
          },
        },
      );
    };
    attempt();
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("focus", attempt);
    return () => {
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("focus", attempt);
    };
  }, [pendingRead, conversationId, qc, anchor]);

  // auto scroll
  const lastId = messages[messages.length - 1]?.id;
  const firstLoad = useRef(true);
  useEffect(() => {
    firstLoad.current = true;
  }, [conversationId]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !lastId) return;
    const mineLast = messages[messages.length - 1]?.senderRole === myRole;
    if (anchor && !firstLoad.current) return;
    if (firstLoad.current || atBottom || mineLast) {
      el.scrollTo({ top: el.scrollHeight, behavior: firstLoad.current ? "auto" : "smooth" });
      firstLoad.current = false;
    }
  }, [lastId, otherTyping, anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const toBottom = () => {
    if (anchor) { leaveAnchor(); return; }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
          className="chat-wall thin-scroll absolute inset-0 overflow-y-auto overscroll-contain"
          data-testid="list-messages"
        >
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end px-3 py-4 sm:px-6">
            {msgs.hasNextPage && <button type="button" disabled={msgs.isFetchingNextPage} onClick={async () => {
              const el = scroller.current;
              const height = el?.scrollHeight ?? 0;
              const top = el?.scrollTop ?? 0;
              await msgs.fetchNextPage();
              requestAnimationFrame(() => { if (el) el.scrollTop = top + el.scrollHeight - height; });
            }} className="mx-auto mb-4 rounded-full bg-card px-4 py-2 text-sm shadow transition-opacity duration-150 disabled:opacity-60" data-testid="button-older-messages">{msgs.isFetchingNextPage ? "Chargement…" : "Charger les messages précédents"}</button>}
            {msgs.isLoading && (
              <div className="space-y-3">
                {[60, 40, 72, 30, 55].map((w, i) => (
                  <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                    <Skeleton className="h-10 rounded-2xl" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            )}
            {msgs.isError && (
              <div className="mx-auto flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center shadow-sm">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="text-sm">Impossible de charger la conversation.</p>
                <button onClick={() => msgs.refetch()} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground" data-testid="button-retry-messages">
                  <RotateCw className="h-4 w-4" /> Réessayer
                </button>
              </div>
            )}
            {msgs.isSuccess && messages.length === 0 && <div className="m-auto">{emptyHint}</div>}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const tail =
                !next ||
                next.senderRole !== m.senderRole ||
                new Date(next.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="sticky top-2 z-10 my-3 flex justify-center">
                      <span className="rounded-full bg-card/85 px-3 py-1 text-[11.5px] font-semibold capitalize text-muted-foreground shadow-sm backdrop-blur">
                        {formatDayLabel(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <Bubble m={m} mine={m.senderRole === myRole} tail={tail} highlight={highlightId === m.id} onQuote={jumpTo} onReply={() => setReplyTo(m)} onMenu={() => setSelected(m)} onOpenImage={(url, blob) => setViewer({ url, blob })} />
                </Fragment>
              );
            })}
            {otherTyping && (
              <div className="mb-2 flex justify-start anim-bubble" data-testid="status-typing">
                <div className="bubble-in flex items-center gap-1 bg-in px-4 py-3">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="typing-dot h-1.5 w-1.5 rounded-full bg-white" style={{ animationDelay: `${d * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {anchor && !pendingJump.current && (
          <button type="button" onClick={leaveAnchor} className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg ring-1 ring-border transition-transform duration-150 active:scale-95 motion-reduce:transition-none" data-testid="button-back-to-recent">
            Revenir aux messages récents
          </button>
        )}
        {(!atBottom || anchor) && (
          <button
            onClick={toBottom}
            className="absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-card text-foreground shadow-lg ring-1 ring-border transition active:scale-90 animate-in zoom-in-75"
            aria-label="Aller en bas"
            data-testid="button-scroll-bottom"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        )}
      </div>
      <Composer key={conversationId} conversationId={conversationId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !deleting) setSelected(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
          <DialogTitle>Actions du message</DialogTitle>
          <DialogDescription className="line-clamp-3 break-words">{selected?.content || (selected?.type === "voice" ? "Message vocal" : "Photo")}</DialogDescription>
          {!!selected?.content && selected.type !== "voice" && <button type="button" onClick={() => void copySelected()} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-muted" data-testid="button-copy"><Copy className="h-5 w-5" />Copier</button>}
          <button type="button" onClick={() => { setReplyTo(selected); setSelected(null); }} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left transition-[background-color,opacity] duration-150 hover:bg-muted disabled:opacity-50" data-testid="button-reply"><Reply className="h-5 w-5" />Répondre</button>
          <button type="button" disabled={deleting} onClick={() => void remove("me")} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left transition-[background-color,opacity] duration-150 hover:bg-muted disabled:opacity-50" data-testid="button-delete-me"><Trash2 className="h-5 w-5" />Supprimer pour moi</button>
          <button type="button" disabled={deleting} onClick={() => void remove("everyone")} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-destructive transition-[background-color,opacity] duration-150 hover:bg-muted disabled:opacity-50" data-testid="button-delete-everyone"><Trash2 className="h-5 w-5" />Supprimer pour tout le monde</button>
        </DialogContent>
      </Dialog>
      {viewer && <ImageViewer url={viewer.url} blob={viewer.blob} onClose={() => setViewer(null)} />}
    </div>
  );
}

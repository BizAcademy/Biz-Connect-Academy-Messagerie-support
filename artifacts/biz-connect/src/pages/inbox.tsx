import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ArrowLeft, Inbox, MessagesSquare, Phone, RotateCw, Search, Star, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSummaryQueryKey,
  getListConversationsQueryKey,
  useGetSummary,
  useListConversations,
  useUpdateConversation,
  type Account,
  type Conversation,
  type ListConversationsFilter,
} from "@workspace/api-client-react";
import { useDebounced } from "@/hooks/use-app";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-fetch";
import { formatLastSeen, formatListTime } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/components/realtime";
import { ChatView } from "@/components/chat/chat-view";
import { UserAvatar } from "@/components/chat/media";
import { ConnectionPill } from "@/components/app-effects";
import { Skeleton } from "@/components/ui/skeleton";

const FILTERS: { key: ListConversationsFilter; label: string; count: "total" | "unread" | "read" | "favorites" }[] = [
  { key: "all", label: "Toutes", count: "total" },
  { key: "unread", label: "Non lues", count: "unread" },
  { key: "read", label: "Lues", count: "read" },
  { key: "favorites", label: "Favoris", count: "favorites" },
];

function useFavorite() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useUpdateConversation();
  return (c: Conversation) =>
    m.mutate(
      { id: c.id, data: { favorite: !c.favorite } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/conversations" });
          void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
        },
        onError: (e) => toast({ title: "Action impossible", description: errorMessage(e), variant: "destructive" }),
      },
    );
}

function Row({ c, active, typing, onOpen, onFav }: { c: Conversation; active: boolean; typing: boolean; onOpen: () => void; onFav: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 px-3 py-2.5 outline-none transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/70 focus-visible:bg-muted/70",
      )}
      data-testid={`row-conversation-${c.id}`}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary" />}
      <UserAvatar name={c.username} src={c.avatarUrl} size={48} online={c.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("truncate text-[15px]", c.unreadCount ? "font-bold" : "font-semibold")}>{c.username}</span>
          {c.favorite && <Star className="h-3 w-3 shrink-0 fill-[#D4AF37] text-[#D4AF37]" />}
          <span className={cn("ml-auto shrink-0 font-mono-num text-[11px]", c.unreadCount ? "font-semibold text-gold" : "text-muted-foreground")}>
            {c.lastMessageAt ? formatListTime(c.lastMessageAt) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={cn("truncate text-[13.5px]", typing ? "font-medium text-[#16A34A]" : c.unreadCount ? "text-foreground/85" : "text-muted-foreground")}>
            {typing ? "écrit…" : c.lastMessage || "Aucun message"}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFav();
              }}
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full transition hover:bg-background",
                c.favorite ? "text-[#D4AF37]" : "text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100",
              )}
              aria-label={c.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              data-testid={`button-favorite-${c.id}`}
            >
              <Star className={cn("h-3.5 w-3.5", c.favorite && "fill-current")} />
            </button>
            {c.unreadCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1.5 font-mono-num text-[11px] font-bold text-[#0B1B3F] animate-in zoom-in-50" data-testid={`badge-unread-${c.id}`}>
                {c.unreadCount > 99 ? "99+" : c.unreadCount}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AdminInbox({ account, onOpenSettings }: { account: Account; onOpenSettings: () => void }) {
  const { status, typing } = useRealtime();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListConversationsFilter>("all");
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("conversation"));
  const q = useDebounced(search.trim(), 250);
  const params = useMemo(() => ({ search: q || undefined, filter }), [q, filter]);
  const list = useListConversations(params, {
    query: { queryKey: getListConversationsQueryKey(params), refetchInterval: status === "online" ? false : 15_000, placeholderData: (p) => p },
  });
  const summary = useGetSummary({ query: { queryKey: getGetSummaryQueryKey() } });
  const toggleFav = useFavorite();
  const known = useRef<Record<string, Conversation>>({});
  (list.data ?? []).forEach((c) => (known.current[c.id] = c));
  const current = selected ? (list.data?.find((c) => c.id === selected) ?? known.current[selected]) : undefined;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("conversation", selected);
    else url.searchParams.delete("conversation");
    window.history.replaceState(window.history.state, "", url);
  }, [selected]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const id = (e.data as { conversationId?: string } | null)?.conversationId;
      if (id) setSelected(id);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className={cn("flex w-full min-w-0 flex-col border-r bg-sidebar md:w-[380px] md:shrink-0", selected && "hidden md:flex")}>
          <header className="px-4 pb-2 pt-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
            <div className="flex items-center gap-3">
              <BrandLogo className="h-10 w-10 rounded-xl" />
              {!!summary.data?.unreadMessages && <span className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded-full bg-gold px-1.5 text-xs font-bold text-[#0B1B3F]" aria-label={`${summary.data.unreadMessages} messages non lus`} data-testid="badge-unread-total">{summary.data.unreadMessages}</span>}
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-xl leading-none">Boîte de réception</h1>
                <div className="mt-1 flex items-center gap-2">
                  <ConnectionPill />
                  {summary.data && (
                    <span className="text-[11px] text-muted-foreground" data-testid="text-online-count">
                      · {summary.data.online} en ligne
                    </span>
                  )}
                </div>
              </div>
              <button onClick={onOpenSettings} className="rounded-full p-1" aria-label="Paramètres" data-testid="button-settings">
                <UserAvatar name={account.username} src={account.avatarUrl} size={36} />
              </button>
            </div>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom d'utilisateur ou numéro"
                className="h-10 w-full rounded-xl border-0 bg-muted pl-9 pr-9 text-sm outline-none ring-primary/40 focus:ring-2"
                data-testid="input-search"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground" aria-label="Effacer" data-testid="button-clear-search">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
              {FILTERS.map((f) => {
                const n = summary.data?.[f.count];
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition active:scale-95",
                      on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={`filter-${f.key}`}
                  >
                    {f.key === "favorites" && <Star className={cn("h-3 w-3", on ? "fill-[#D4AF37] text-[#D4AF37]" : "")} />}
                    {f.label}
                    {n !== undefined && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 font-mono-num text-[10.5px]",
                          f.key === "unread" && n > 0 ? "bg-gold text-[#0B1B3F]" : on ? "bg-background/20" : "bg-background",
                        )}
                      >
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </header>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-4" data-testid="list-conversations">
            {list.isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            {list.isError && (
              <div className="m-4 rounded-2xl border border-dashed p-5 text-center text-sm">
                Liste indisponible.
                <button onClick={() => list.refetch()} className="mx-auto mt-3 flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 font-semibold text-primary-foreground" data-testid="button-retry-list">
                  <RotateCw className="h-4 w-4" /> Réessayer
                </button>
              </div>
            )}
            {list.isSuccess && list.data.length === 0 && (
              <div className="flex flex-col items-center px-8 py-16 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Inbox className="h-6 w-6" />
                </div>
                <p className="mt-4 font-semibold">{q ? "Aucun résultat" : filter === "unread" ? "Tout est lu" : filter === "favorites" ? "Aucun favori" : "Aucune conversation"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {q ? `Rien ne correspond à « ${q} ».` : filter === "favorites" ? "Touchez l'étoile d'un membre pour l'épingler ici." : "Les nouveaux messages des membres apparaîtront ici."}
                </p>
              </div>
            )}
            {list.data?.map((c) => (
              <Row key={c.id} c={c} active={c.id === selected} typing={!!typing[c.id]} onOpen={() => setSelected(c.id)} onFav={() => toggleFav(c)} />
            ))}
          </div>
        </aside>

        <main className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
          {selected ? (
            <ChatView
              key={selected}
              conversationId={selected}
              myRole="admin"
              unreadCount={current?.unreadCount ?? 0}
              emptyHint={<p className="rounded-full bg-card/80 px-4 py-2 text-sm text-muted-foreground">Aucun message pour l'instant.</p>}
              header={
                <div className="flex items-center gap-3 border-b bg-card/90 px-2 py-2 backdrop-blur-xl sm:px-4" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
                  <button onClick={() => setSelected(null)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted md:hidden" aria-label="Retour" data-testid="button-back">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  {current ? (
                    <>
                      <UserAvatar name={current.username} src={current.avatarUrl} size={40} online={current.online} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold" data-testid="text-conversation-username">{current.username}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <a href={`tel:${current.phone}`} className="inline-flex items-center gap-1 font-mono-num hover:text-foreground" data-testid="link-phone">
                            <Phone className="h-3 w-3" /> {current.phone}
                          </a>
                          <span>·</span>
                          <span className={cn(typing[current.id] || current.online ? "font-medium text-[#16A34A]" : "")}>
                            {typing[current.id] ? "écrit…" : current.online ? "en ligne" : formatLastSeen(current.lastSeen)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFav(current)}
                        className={cn("grid h-10 w-10 place-items-center rounded-full transition hover:bg-muted active:scale-90", current.favorite ? "text-[#D4AF37]" : "text-muted-foreground")}
                        aria-label="Favori"
                        data-testid="button-favorite-header"
                      >
                        <Star className={cn("h-5 w-5", current.favorite && "fill-current")} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  )}
                </div>
              }
            />
          ) : (
            <div className="chat-wall flex h-full flex-col items-center justify-center p-10 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-3xl bg-card text-primary shadow-sm">
                <MessagesSquare className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-2xl">Choisissez une conversation</h2>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                {summary.data?.unread ? `${summary.data.unread} message(s) attendent une réponse.` : "Aucun message en attente. Belle journée."}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

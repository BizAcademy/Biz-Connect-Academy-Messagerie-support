import { RotateCw, ShieldCheck } from "lucide-react";
import { getListConversationsQueryKey, useListConversations, type Account } from "@workspace/api-client-react";
import { useRealtime } from "@/components/realtime";
import { ChatView } from "@/components/chat/chat-view";
import { UserAvatar } from "@/components/chat/media";
import { ConnectionPill, InstallBanner } from "@/components/app-effects";
import { Skeleton } from "@/components/ui/skeleton";

export function MemberChat({ account, onOpenSettings }: { account: Account; onOpenSettings: () => void }) {
  const { status, typing } = useRealtime();
  const list = useListConversations(undefined, {
    query: { queryKey: getListConversationsQueryKey(), refetchInterval: status === "online" ? false : 15_000 },
  });
  const conv = list.data?.[0];

  const header = (
    <div className="flex items-center gap-3 border-b bg-card/90 px-3 py-2 backdrop-blur-xl sm:px-5" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
      <UserAvatar name="Biz Connect Academy" team size={42} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[17px] leading-tight">Équipe Biz Connect Academy</div>
        <div className="text-xs">
          {conv && typing[conv.id] ? <span className="font-medium text-[#16A34A]">un conseiller écrit…</span> : <ConnectionPill />}
        </div>
      </div>
      <button onClick={onOpenSettings} className="rounded-full p-0.5" aria-label="Paramètres" data-testid="button-settings">
        <UserAvatar name={account.username} src={account.avatarUrl} size={36} />
      </button>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col">
      <InstallBanner />
      <div className="min-h-0 flex-1">
        {conv ? (
          <ChatView
            conversationId={conv.id}
            myRole="member"
            unreadCount={conv.unreadCount}
            header={header}
            emptyHint={
              <div className="mx-auto max-w-sm rounded-3xl bg-card/95 p-6 text-center shadow-sm ring-1 ring-border">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#0B1B3F] text-[#D4AF37]">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h2 className="mt-4 font-display text-xl">Bonjour {account.username}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Cette ligne est privée et vous relie directement à l'équipe de l'académie. Posez votre question, envoyez une capture ou une note vocale.
                </p>
              </div>
            }
          />
        ) : (
          <div className="flex h-full flex-col">
            {header}
            <div className="chat-wall flex flex-1 items-center justify-center p-6">
              {list.isError || (list.isSuccess && !conv) ? (
                <div className="rounded-2xl bg-card p-6 text-center shadow-sm">
                  <p className="text-sm">{list.isError ? "Connexion à votre conversation impossible." : "Votre conversation n'est pas encore ouverte."}</p>
                  <button onClick={() => list.refetch()} className="mx-auto mt-3 flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground" data-testid="button-retry-conversation">
                    <RotateCw className="h-4 w-4" /> Réessayer
                  </button>
                </div>
              ) : (
                <div className="w-full max-w-3xl space-y-3">
                  <Skeleton className="h-10 w-1/2 rounded-2xl" />
                  <Skeleton className="ml-auto h-10 w-1/3 rounded-2xl" />
                  <Skeleton className="h-16 w-3/5 rounded-2xl" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellOff, Camera, Loader2, LogOut, Moon, Phone, ShieldCheck, Sun, Volume2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPushConfigQueryKey,
  getGetSessionQueryKey,
  useGetPushConfig,
  useLogout,
  useSubscribePush,
  useUpdateProfile,
  useUploadFile,
  type Account,
  type Session,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/chat/media";
import { useTheme } from "@/hooks/use-app";
import { useToast } from "@/hooks/use-toast";
import { cropAvatar, urlBase64ToUint8Array } from "@/lib/chat-utils";
import { errorMessage } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {hint && <div className="text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [sound, setSound] = useState(localStorage.getItem("bca-sound") !== "off");
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [enabling, setEnabling] = useState(false);

  const upload = useUploadFile();
  const updateProfile = useUpdateProfile();
  const push = useGetPushConfig({ query: { queryKey: getGetPushConfigQueryKey(), enabled: open, staleTime: 300_000 } });
  const subscribe = useSubscribePush();
  const logout = useLogout();

  const pickAvatar = async (f?: File) => {
    if (!f) return;
    try {
      const blob = await cropAvatar(f);
      setAvatarPreview({ blob, url: URL.createObjectURL(blob) });
    } catch {
      toast({ title: "Image illisible", variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const saveAvatar = () => {
    if (!avatarPreview) return;
    upload.mutate(
      { data: { file: avatarPreview.blob, purpose: "avatar" } },
      {
        onSuccess: (file) =>
          updateProfile.mutate(
            { data: { avatarFileId: file.id } },
            {
              onSuccess: (acc) => {
                qc.setQueryData<Session>(getGetSessionQueryKey(), (old) => (old ? { ...old, account: acc } : old));
                URL.revokeObjectURL(avatarPreview.url);
                setAvatarPreview(null);
                toast({ title: "Photo mise à jour" });
              },
              onError: (e) => toast({ title: "Mise à jour impossible", description: errorMessage(e), variant: "destructive" }),
            },
          ),
        onError: (e) => toast({ title: "Envoi impossible", description: errorMessage(e), variant: "destructive" }),
      },
    );
  };

  const supportsPush = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
  const enableNotifications = async () => {
    if (!push.data?.enabled || !push.data.publicKey) return;
    setEnabling(true);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") {
        toast({ title: "Notifications refusées", description: "Vous pouvez les autoriser depuis les réglages du navigateur." });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(push.data.publicKey) }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("subscription");
      await subscribe.mutateAsync({ data: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
      toast({ title: "Notifications activées", description: "Vous serez prévenu des nouveaux messages." });
    } catch (e) {
      toast({ title: "Activation impossible", description: errorMessage(e, "L'abonnement aux notifications a échoué."), variant: "destructive" });
    } finally {
      setEnabling(false);
    }
  };

  const doLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        qc.clear();
        onOpenChange(false);
        navigate("/login");
      },
    });

  const busyAvatar = upload.isPending || updateProfile.isPending;
  const isAdmin = account.role === "admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-md" data-testid="dialog-settings">
        <div className="relative overflow-hidden bg-[#0B1B3F] px-6 pb-6 pt-8 text-white">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-[#D4AF37]/30" />
          <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full border border-[#D4AF37]/20" />
          <DialogHeader className="relative text-left">
            <DialogTitle className="font-display text-2xl font-medium">Profil et préférences</DialogTitle>
            <DialogDescription className="text-white/60">
              {isAdmin ? "Compte équipe" : "Membre"} · Biz Connect Academy
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative rounded-full"
              aria-label="Changer la photo"
              data-testid="button-change-avatar"
            >
              {avatarPreview ? (
                <img src={avatarPreview.url} alt="Nouvelle photo" className="h-20 w-20 rounded-full object-cover ring-2 ring-[#D4AF37]" />
              ) : (
                <UserAvatar name={account.username} src={account.avatarUrl} size={80} />
              )}
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-5 w-5" />
              </span>
              <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-gold text-[#0B1B3F]">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickAvatar(e.target.files?.[0])} data-testid="input-avatar-file" />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold" data-testid="text-username">{account.username}</div>
              <div className="flex items-center gap-1.5 text-sm text-white/65" data-testid="text-phone">
                <Phone className="h-3.5 w-3.5" /> {account.phone || "Non renseigné"}
              </div>
            </div>
          </div>
          {avatarPreview && (
            <div className="relative mt-4 flex gap-2 animate-in fade-in slide-in-from-top-1">
              <button onClick={saveAvatar} disabled={busyAvatar} className="flex-1 rounded-full bg-gold py-2 text-sm font-bold text-[#0B1B3F] disabled:opacity-60" data-testid="button-save-avatar">
                {busyAvatar ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Enregistrer la photo"}
              </button>
              <button
                onClick={() => {
                  URL.revokeObjectURL(avatarPreview.url);
                  setAvatarPreview(null);
                }}
                className="rounded-full border border-white/25 px-4 text-sm"
                data-testid="button-cancel-avatar"
              >
                Annuler
              </button>
            </div>
          )}
          <p className="relative mt-3 text-[11px] text-white/45">Recadrée au centre, redimensionnée et stockée en privé.</p>
        </div>

        <div className="divide-y">
          <Row icon={theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} title="Thème sombre" hint="Plus doux le soir.">
            <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} data-testid="switch-theme" />
          </Row>
          <Row icon={<Volume2 className="h-4 w-4" />} title="Son des nouveaux messages" hint="Joué uniquement après une interaction.">
            <Switch
              checked={sound}
              onCheckedChange={(v) => {
                setSound(v);
                localStorage.setItem("bca-sound", v ? "on" : "off");
              }}
              data-testid="switch-sound"
            />
          </Row>
          <Row
            icon={perm === "granted" ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            title="Notifications"
            hint={
              push.isLoading
                ? "Vérification de la configuration…"
                : !supportsPush
                  ? "Ce navigateur ne prend pas en charge les notifications. Sur iPhone, installez d'abord l'application sur l'écran d'accueil."
                  : push.isError
                    ? "Configuration indisponible pour le moment."
                    : !push.data?.enabled
                      ? "Les notifications push ne sont pas encore configurées sur le serveur (clés VAPID requises)."
                      : perm === "denied"
                        ? "Bloquées par le navigateur. Autorisez-les dans les réglages du site."
                        : perm === "granted"
                          ? "Autorisées sur cet appareil."
                          : "Recevez une alerte même quand l'application est fermée."
            }
          >
            {supportsPush && push.data?.enabled && perm !== "denied" && (
              <button
                onClick={enableNotifications}
                disabled={enabling}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95",
                  perm === "granted" ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground",
                )}
                data-testid="button-enable-notifications"
              >
                {enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : perm === "granted" ? "Réactiver" : "Activer"}
              </button>
            )}
          </Row>
          <Row icon={<ShieldCheck className="h-4 w-4" />} title="Connexion privée" hint="Vos échanges restent entre vous et l'équipe de l'académie." />
          <div className="p-4">
            <button
              onClick={doLogout}
              disabled={logout.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/5 active:scale-[0.99]"
              data-testid="button-logout"
            >
              {logout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Se déconnecter
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, ArrowRight, Eye, EyeOff, Headset, Loader2, Lock, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey, useDemoLogin, useLogin, type Session } from "@workspace/api-client-react";
import { errorMessage, setCsrfToken } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

type Role = "member" | "admin";

export default function LoginPage({ session }: { session: Session | undefined }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [role, setRole] = useState<Role>("member");
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (s: Session) => {
    setCsrfToken(s.csrfToken);
    qc.setQueryData(getGetSessionQueryKey(), s);
    navigate("/");
  };
  const login = useLogin({
    mutation: { onSuccess: done, onError: (e) => setError(errorMessage(e, "Connexion impossible. Vérifiez vos informations.")) },
  });
  const demo = useDemoLogin({
    mutation: { onSuccess: done, onError: (e) => setError(errorMessage(e, "Accès de démonstration indisponible.")) },
  });
  const busy = login.isPending || demo.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !credential.trim()) {
      setError("Renseignez les deux champs.");
      return;
    }
    login.mutate({ data: { role, username: username.trim(), credential: credential.trim() } });
  };

  const labels =
    role === "member"
      ? { user: "Nom d'utilisateur Biz Connect Academy", cred: "Numéro Biz Connect Academy", credType: "text", mode: "numeric" as const }
      : { user: "Nom d'utilisateur", cred: "Mot de passe", credType: show ? "text" : "password", mode: "text" as const };

  return (
    <div className="grain relative min-h-[100dvh] overflow-hidden bg-[#0B1B3F] text-white">
      <div className="pointer-events-none absolute -left-40 top-10 h-[520px] w-[520px] rounded-full bg-[#1E5EFF]/25 blur-[110px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-[#16A34A]/15 blur-[110px]" />
      <svg className="pointer-events-none absolute right-[-120px] top-[-120px] h-[420px] w-[420px] opacity-40" viewBox="0 0 400 400" fill="none">
        {[60, 110, 160, 200].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="#D4AF37" strokeOpacity={0.35} />
        ))}
      </svg>

      <div className="relative mx-auto grid min-h-[100dvh] max-w-6xl items-center gap-10 px-5 py-10 md:grid-cols-[1.1fr_1fr] md:px-10">
        <section className="rise">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#D4AF37] font-display text-2xl text-[#0B1B3F]">B</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/60">Biz Connect Academy</div>
          </div>
          <h1 className="mt-8 font-display text-[44px] leading-[1.02] md:text-[68px]">
            Une ligne directe
            <br />
            <span className="italic text-[#D4AF37]">avec votre équipe.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/65">
            Une messagerie privée, réservée aux membres de l'académie. De vraies personnes vous répondent, ici, sans détour.
          </p>
          <div className="mt-8 hidden max-w-sm space-y-2 md:block" aria-hidden>
            <div className="bubble-in w-fit bg-in px-4 py-2 text-sm">Bonjour, une question sur le module 3 ?</div>
            <div className="bubble-out ml-auto w-fit bg-out px-4 py-2 text-sm">Oui, je bloque sur l'exercice final.</div>
            <div className="bubble-in w-fit bg-in px-4 py-2 text-sm">On regarde ça ensemble.</div>
          </div>
        </section>

        <section className="rise w-full rounded-[28px] bg-card p-6 text-card-foreground shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] md:p-8" style={{ animationDelay: "120ms" }}>
          <h2 className="font-display text-2xl">Connexion</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choisissez votre accès.</p>

          <div className="relative mt-5 grid grid-cols-2 rounded-2xl bg-muted p-1" role="tablist">
            <span
              className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl bg-card shadow-sm transition-transform duration-300"
              style={{ transform: role === "admin" ? "translateX(100%)" : "none" }}
            />
            {(["member", "admin"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={role === r}
                onClick={() => {
                  setRole(r);
                  setError(null);
                  setCredential("");
                }}
                className={cn("relative z-10 flex items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors", role === r ? "text-foreground" : "text-muted-foreground")}
                data-testid={`tab-role-${r}`}
              >
                {r === "member" ? <UserRound className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
                {r === "member" ? "Membre" : "Équipe"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <label className="block">
              <span className="text-[13px] font-semibold">{labels.user}</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                maxLength={80}
                className="mt-1.5 h-12 w-full rounded-xl border bg-background px-4 text-[15px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                data-testid="input-username"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold">{labels.cred}</span>
              <div className="relative mt-1.5">
                <input
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  type={labels.credType}
                  inputMode={labels.mode}
                  autoComplete={role === "admin" ? "current-password" : "off"}
                  maxLength={200}
                  className="h-12 w-full rounded-xl border bg-background px-4 pr-12 text-[15px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  data-testid="input-credential"
                />
                {role === "admin" && (
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={show ? "Masquer" : "Afficher"} data-testid="button-toggle-password">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-in fade-in slide-in-from-top-1" role="alert" data-testid="text-login-error">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-out font-bold text-white shadow-[0_12px_24px_-12px_#1E5EFF] transition active:scale-[0.99] disabled:opacity-60"
              data-testid="button-login"
            >
              {login.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Se connecter <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>

          {session?.demoAvailable && (
            <div className="mt-6 rounded-2xl border border-dashed border-[#D4AF37]/60 p-4" data-testid="panel-demo">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#B8952A] dark:text-[#D4AF37]">Environnement de démonstration</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => { setError(null); demo.mutate({ data: { role: "member" } }); }} className="rounded-xl bg-secondary px-3 py-2.5 text-sm font-semibold transition hover:bg-secondary/70 active:scale-[0.98] disabled:opacity-60" data-testid="button-demo-member">
                  Démo membre
                </button>
                <button type="button" disabled={busy} onClick={() => { setError(null); demo.mutate({ data: { role: "admin" } }); }} className="rounded-xl bg-secondary px-3 py-2.5 text-sm font-semibold transition hover:bg-secondary/70 active:scale-[0.98] disabled:opacity-60" data-testid="button-demo-admin">
                  Démo équipe
                </button>
              </div>
            </div>
          )}

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Connexion chiffrée · accès réservé aux membres
          </p>
        </section>
      </div>
    </div>
  );
}

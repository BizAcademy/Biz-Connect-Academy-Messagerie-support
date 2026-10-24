import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useLocation } from "wouter";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey, useDemoLogin, useLogin, type Session } from "@workspace/api-client-react";
import { errorMessage, setCsrfToken } from "@/lib/api-fetch";

export default function LoginPage({ session }: { session: Session | undefined }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [show, setShow] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const done = (s: Session) => {
    setCsrfToken(s.csrfToken);
    // Never carry a previous account's inbox/messages into a new session.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
    qc.setQueryData(getGetSessionQueryKey(), s);
    navigate("/");
  };
  const login = useLogin({
    mutation: { onSuccess: done, onError: (e) => setError(errorMessage(e, "Ouverture de session impossible. Vérifiez vos informations.")) },
  });
  const demo = useDemoLogin({
    mutation: { onSuccess: done, onError: (e) => setError(errorMessage(e, "Session de démonstration indisponible.")) },
  });
  const busy = login.isPending || demo.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !credential.trim()) {
      setError("Renseignez le nom d’utilisateur et le numéro de téléphone.");
      return;
    }
    login.mutate({ data: { username: username.trim(), credential } });
  };

  const field =
    "peer h-14 w-full rounded-xl border border-[#3A4A5E] bg-transparent px-4 pt-3 text-[16px] text-[#E8EEF5] outline-none transition placeholder:text-transparent focus:border-[#5AA9F0]";
  const floatLabel =
    "pointer-events-none absolute left-3 top-0 -translate-y-1/2 bg-[#1C2733] px-1.5 text-[12px] text-[#8A9AAD] transition peer-focus:text-[#5AA9F0]";

  return (
    <div className="relative min-h-[100dvh] bg-[#1C2733] text-[#E8EEF5]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-6 pb-8 pt-6 md:justify-center md:py-12">
        <div className="flex justify-end md:hidden">
          <ShieldCheck className="h-7 w-7 text-[#C9D4E0]" aria-hidden />
        </div>

        <div className="rise mt-12 flex flex-col items-center text-center md:mt-0">
          <BrandLogo className="h-20 w-20 rounded-2xl" />
          <h1 className="mt-6 text-[21px] font-semibold tracking-tight">Ouvrir votre session de chat</h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-[#8A9AAD]">
            Pour ouvrir votre session de chat et pouvoir discuter avec le support Biz Connect Academy, veuillez saisir le nom d’utilisateur et le numéro de téléphone de votre compte Biz Connect Academy.
          </p>
        </div>

        <form onSubmit={submit} className="rise mt-9 flex flex-1 flex-col md:flex-none" style={{ animationDelay: "90ms" }} noValidate>
          <div className="space-y-6">
            <label className="relative block">
              <input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                maxLength={80}
                placeholder="Nom d’utilisateur"
                className={field}
                data-testid="input-username"
              />
              <span className={floatLabel}>Nom d’utilisateur</span>
            </label>

            <label className="relative block">
              <input
                id="login-credential"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                type={show ? "tel" : "password"}
                autoComplete="tel"
                maxLength={200}
                placeholder="Numéro de téléphone"
                className={`${field} pr-12`}
                data-testid="input-credential"
              />
              <span className={floatLabel}>Numéro de téléphone</span>
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-[#8A9AAD] transition hover:bg-white/5 hover:text-[#E8EEF5]"
                aria-label={show ? "Masquer la saisie" : "Afficher la saisie"}
                aria-pressed={show}
                data-testid="button-toggle-password"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>
            <p className="-mt-3 px-1 text-[12.5px] text-[#6F8096]">Indicatif du pays obligatoire : commencez par +, par exemple +237 658706264 pour le Cameroun.</p>
          </div>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#E5534B]/12 px-3 py-2.5 text-sm text-[#F28B84] animate-in fade-in slide-in-from-top-1" role="alert" data-testid="text-login-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-4 pt-10 md:mt-8">
            <span className="text-[13px] text-[#8A9AAD]">Ouvrir le chat</span>
            <button
              type="submit"
              disabled={busy}
              aria-label="Ouvrir la session de chat"
              className="grid h-14 w-14 place-items-center rounded-full bg-[#5AA9F0] text-[#13202C] shadow-[0_10px_24px_-10px_rgba(90,169,240,0.8)] transition hover:brightness-110 active:scale-95 disabled:opacity-60"
              data-testid="button-login"
            >
              {login.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-6 w-6" />}
            </button>
          </div>
        </form>

        {session?.demoAvailable && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-dashed border-[#3A4A5E] px-4 py-3" data-testid="panel-demo">
            <span className="text-[12px] uppercase tracking-[0.18em] text-[#8A9AAD]">Démonstration</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setError(null); demo.mutate({ data: { role: "member" } }); }}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-60"
              data-testid="button-demo-member"
            >
              Session démo membre
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

let csrfToken = "";
const listeners = new Set<() => void>();

export function setCsrfToken(token: string | undefined | null) {
  if (token) csrfToken = token;
}
export function getCsrfToken() {
  return csrfToken;
}
export function onSessionRehydrate(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let refreshing: Promise<boolean> | null = null;

/**
 * Wraps window.fetch for same-origin /api requests:
 * - attaches x-csrf-token on mutations
 * - forces same-origin cookie credentials
 * - on 401, POSTs /api/auth/refresh once, retries, and asks the app to rehydrate
 */
export function installApiFetch() {
  const w = window as unknown as { __bcaFetch?: boolean };
  if (w.__bcaFetch) return;
  w.__bcaFetch = true;
  const orig = window.fetch.bind(window);

  const doRefresh = () => {
    if (!refreshing) {
      refreshing = orig("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
      })
        .then(async (r) => {
          if (!r.ok) return false;
          const s = (await r.json().catch(() => null)) as { csrfToken?: string; account?: unknown } | null;
          if (s?.csrfToken) csrfToken = s.csrfToken;
          return !!s?.account;
        })
        .catch(() => false)
        .finally(() => {
          setTimeout(() => {
            refreshing = null;
          }, 0);
        });
    }
    return refreshing;
  };

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return orig(input, init);
    }
    const build = (): RequestInit => {
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD" && csrfToken) headers.set("x-csrf-token", csrfToken);
      return { ...init, headers, credentials: "same-origin" };
    };
    let res = await orig(input, build());
    if (res.status === 401 && !url.pathname.startsWith("/api/auth/")) {
      const ok = await doRefresh();
      if (ok) res = await orig(input, build());
      listeners.forEach((l) => l());
    }
    return res;
  };
}

export function errorMessage(e: unknown, fallback = "Une erreur est survenue."): string {
  if (!e) return fallback;
  const anyE = e as { data?: unknown; message?: string; status?: number };
  const d = anyE.data as { error?: string; message?: string } | string | null | undefined;
  if (typeof d === "string" && d.length < 200) return d;
  if (d && typeof d === "object") {
    if (typeof d.error === "string") return d.error;
    if (typeof d.message === "string") return d.message;
  }
  if (anyE.status === 401) return "Identifiants invalides ou session expirée.";
  if (anyE.status === 429) return "Trop de tentatives. Patientez un instant.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Vous êtes hors ligne.";
  return fallback;
}

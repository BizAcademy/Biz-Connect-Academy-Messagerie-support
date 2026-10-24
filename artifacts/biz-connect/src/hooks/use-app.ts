import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey, useGetSession } from "@workspace/api-client-react";
import { onSessionRehydrate, setCsrfToken } from "@/lib/api-fetch";

export function useSession() {
  const qc = useQueryClient();
  const q = useGetSession({ query: {
    queryKey: getGetSessionQueryKey(), staleTime: 60_000, retry: 1,
    refetchInterval: 10 * 60_000,
  } });
  useEffect(() => {
    setCsrfToken(q.data?.csrfToken);
  }, [q.data?.csrfToken]);
  useEffect(
    () => onSessionRehydrate(() => void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() })),
    [qc],
  );
  return q;
}

type Theme = "light" | "dark";
const read = (): Theme => {
  const s = localStorage.getItem("bca-theme");
  if (s === "light" || s === "dark") return s;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
const themeListeners = new Set<(t: Theme) => void>();
export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0A1022" : "#F3F5FB");
}
export function useTheme() {
  const [theme, set] = useState<Theme>(read);
  useEffect(() => {
    const l = (t: Theme) => set(t);
    themeListeners.add(l);
    return () => {
      themeListeners.delete(l);
    };
  }, []);
  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("bca-theme", t);
    applyTheme(t);
    themeListeners.forEach((l) => l(t));
  }, []);
  return { theme, setTheme };
}
export const initTheme = () => applyTheme(read());

export function useBlobUrl(src: string | null | undefined) {
  const [state, setState] = useState<{ url: string | null; blob: Blob | null; error: boolean }>({
    url: null,
    blob: null,
    error: false,
  });
  useEffect(() => {
    if (!src) {
      setState({ url: null, blob: null, error: false });
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setState({ url: null, blob: null, error: false });
    fetch(src, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setState({ url: objectUrl, blob: b, error: false });
      })
      .catch(() => alive && setState({ url: null, blob: null, error: true }));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return state;
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

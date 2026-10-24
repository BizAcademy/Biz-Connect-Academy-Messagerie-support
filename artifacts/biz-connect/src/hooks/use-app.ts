import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useBlobUrl(src: string | null | undefined, enabled = true) {
  const media = useQuery({
    queryKey: ["private-media", src],
    enabled: !!src && enabled,
    staleTime: Infinity, // Immutable UUID media; cache is cleared with the session.
    gcTime: 20 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const response = await fetch(src!, { credentials: "same-origin", signal });
      if (!response.ok) throw new Error("Média indisponible");
      return response.blob();
    },
  });
  const [state, setState] = useState<{ url: string | null; blob: Blob | null; error: boolean }>({
    url: null,
    blob: null,
    error: false,
  });
  useEffect(() => {
    if (!media.data) {
      setState({ url: null, blob: null, error: false });
      return;
    }
    const objectUrl = URL.createObjectURL(media.data);
    setState({ url: objectUrl, blob: media.data, error: false });
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [media.data]);
  return { ...state, error: media.isError };
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

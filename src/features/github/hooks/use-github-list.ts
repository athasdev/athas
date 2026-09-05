import { useCallback, useEffect, useRef, useState } from "react";
import type { TimedResourceCache } from "@/utils/timed-resource-cache";

interface GitHubListState<T> {
  key: string | null;
  data: T[];
  isLoading: boolean;
  error: string | null;
}

export function useGitHubList<T>({
  cache,
  cacheKey,
  enabled,
  load,
  refreshNonce,
  ttlMs,
}: {
  cache: TimedResourceCache<T[]>;
  cacheKey: string | null;
  enabled: boolean;
  load: () => Promise<T[]>;
  refreshNonce: number;
  ttlMs: number;
}) {
  const [state, setState] = useState<GitHubListState<T>>({
    key: null,
    data: [],
    isLoading: false,
    error: null,
  });
  const [retryNonce, setRetryNonce] = useState(0);
  const previousRefresh = useRef({ refreshNonce, retryNonce });
  const refresh = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    const force =
      previousRefresh.current.refreshNonce !== refreshNonce ||
      previousRefresh.current.retryNonce !== retryNonce;
    previousRefresh.current = { refreshNonce, retryNonce };
    if (!enabled || !cacheKey) return;

    let cancelled = false;
    const cached = cache.getSnapshot(cacheKey)?.value;
    const fresh = !force && cache.getFreshValue(cacheKey, ttlMs) !== null;
    setState((current) => ({
      key: cacheKey,
      data: cached ?? (current.key === cacheKey ? current.data : []),
      isLoading: !fresh,
      error: null,
    }));
    if (fresh) return;

    void cache.load(cacheKey, load, { force, ttlMs }).then(
      (data) => {
        if (!cancelled) setState({ key: cacheKey, data, isLoading: false, error: null });
      },
      (error: unknown) => {
        if (!cancelled)
          setState((current) => ({
            key: cacheKey,
            data: current.key === cacheKey ? current.data : [],
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cache, cacheKey, enabled, load, refreshNonce, retryNonce, ttlMs]);

  const current: GitHubListState<T> =
    !enabled || !cacheKey
      ? {
          key: cacheKey,
          data: [],
          isLoading: false,
          error: enabled ? "No repository selected." : null,
        }
      : state.key === cacheKey
        ? state
        : {
            key: cacheKey,
            data: cache.getSnapshot(cacheKey)?.value ?? [],
            isLoading: true,
            error: null,
          };

  return { ...current, refresh };
}

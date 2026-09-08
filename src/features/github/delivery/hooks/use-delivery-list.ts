import { useCallback, useEffect, useRef, useState } from "react";
import {
  DELIVERY_CHANGED,
  DELIVERY_PAGE_SIZE,
  DELIVERY_LIST_TTL,
  loadDeliveryPage,
} from "../services/github-delivery-service";
import type { DeliveryKind, DeliveryResource } from "../types/github-delivery.types";

export function useDeliveryList(
  kind: DeliveryKind,
  repoPath: string,
  enabled: boolean,
  refreshNonce: number,
) {
  const [items, setItems] = useState<DeliveryResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const page = useRef(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const load = useCallback(
    async (more = false, force = false) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      const request = generation.current;
      setLoading(true);
      setError(null);
      try {
        const nextPage = more ? page.current + 1 : 1;
        const next = await loadDeliveryPage(kind, repoPath, nextPage, force);
        if (request !== generation.current) return;
        setItems((current) =>
          more
            ? [...current.filter((item) => !next.some((value) => value.id === item.id)), ...next]
            : next,
        );
        page.current = nextPage;
        setHasMore(next.length === DELIVERY_PAGE_SIZE);
      } catch (error) {
        if (request === generation.current) setError(String(error));
      } finally {
        if (request === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [enabled, kind, repoPath],
  );
  useEffect(() => {
    generation.current++;
    busy.current = false;
    page.current = 0;
    setItems([]);
    setHasMore(true);
    void load(false, refreshNonce > 0);
    return () => {
      generation.current++;
      busy.current = false;
    };
  }, [load, refreshNonce]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.kind === kind && detail?.repoPath === repoPath) {
        generation.current++;
        busy.current = false;
        void load(false, true);
      }
    };
    const poll = () => {
      if (document.visibilityState === "visible" && page.current <= 1) void load(false, true);
    };
    const interval = window.setInterval(poll, DELIVERY_LIST_TTL);
    window.addEventListener(DELIVERY_CHANGED, changed);
    window.addEventListener("focus", poll);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(DELIVERY_CHANGED, changed);
      window.removeEventListener("focus", poll);
    };
  }, [kind, load, repoPath]);
  return {
    items,
    loading,
    error,
    hasMore,
    refresh: () => void load(false, true),
    loadMore: () => void load(true),
  };
}

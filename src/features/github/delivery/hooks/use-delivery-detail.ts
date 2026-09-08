import { useCallback, useEffect, useState } from "react";
import {
  DELIVERY_CHANGED,
  DELIVERY_TTL,
  deliveryDetailCache,
  loadDeliveryDetail,
} from "../services/github-delivery-service";
import type { DeliveryKind, DeliveryResource } from "../types/github-delivery.types";
import { deliveryKey } from "../utils/github-delivery";

export function useDeliveryDetail(
  kind: DeliveryKind,
  repoPath: string,
  id: number | undefined,
  active: boolean,
) {
  const key = id === undefined ? null : deliveryKey(kind, repoPath, id);
  const [state, setState] = useState<{
    key: string | null;
    data: DeliveryResource | null;
    error: string | null;
    loading: boolean;
  }>({ key: null, data: null, error: null, loading: false });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    if (!key || id === undefined) return;
    let cancelled = false;
    setState((previous) => ({
      key,
      data:
        previous.key === key
          ? previous.data
          : (deliveryDetailCache.getSnapshot(key)?.value ?? null),
      error: null,
      loading: true,
    }));
    void loadDeliveryDetail(kind, repoPath, id, nonce > 0).then(
      (data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      },
      (error) => {
        if (!cancelled)
          setState((previous) => ({ ...previous, error: String(error), loading: false }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, key, kind, nonce, repoPath]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.kind === kind && detail?.repoPath === repoPath && detail?.id === id) refresh();
    };
    const poll = () => {
      if (active && document.visibilityState === "visible") refresh();
    };
    const interval = kind === "deployments" ? window.setInterval(poll, DELIVERY_TTL) : null;
    window.addEventListener(DELIVERY_CHANGED, changed);
    window.addEventListener("focus", poll);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      window.removeEventListener(DELIVERY_CHANGED, changed);
      window.removeEventListener("focus", poll);
    };
  }, [active, id, kind, refresh, repoPath]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: state.key !== key || state.loading,
    refresh,
  };
}

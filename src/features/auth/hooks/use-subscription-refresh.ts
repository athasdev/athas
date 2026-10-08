import { useEffect } from "react";
import { useAuthStore } from "@/features/auth/stores/auth.store";

/**
 * Keeps the plan and hosted AI credits current while a surface that shows them is mounted:
 * on window focus (which also covers returning from the billing page) and, when given, on an
 * interval. Refreshes go through the store's debounce, so several surfaces cost one request.
 */
export function useSubscriptionRefresh(options: { intervalMs?: number } = {}) {
  const { intervalMs } = options;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      useAuthStore.getState().actions.scheduleSubscriptionRefresh();
    };
    window.addEventListener("focus", refresh);
    const timer = intervalMs ? setInterval(refresh, intervalMs) : null;
    return () => {
      window.removeEventListener("focus", refresh);
      if (timer) clearInterval(timer);
    };
  }, [intervalMs, isAuthenticated]);
}

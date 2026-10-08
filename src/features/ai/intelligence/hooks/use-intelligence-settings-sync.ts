import { useEffect } from "react";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useIntelligenceSettingsStore } from "../stores/intelligence-settings.store";

/**
 * Keeps the signed-in user's intelligence settings current: loads them for the user and refreshes
 * them when the window regains focus or the network comes back.
 */
export function useIntelligenceSettingsSync() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    void useIntelligenceSettingsStore.getState().actions.setUser(userId);
    const refresh = () => void useIntelligenceSettingsStore.getState().actions.refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [userId]);
}

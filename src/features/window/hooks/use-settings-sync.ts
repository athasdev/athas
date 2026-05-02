import { useEffect, useRef } from "react";
import {
  ensureSettingsSyncStarted,
  initializeSettingsSyncPreferences,
} from "@/features/settings/lib/settings-sync";
import { useAuthStore } from "@/features/window/stores/auth-store";

export function useSettingsSync() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasHydrated = useRef(false);
  const isPro = subscription?.status === "pro";

  useEffect(() => {
    if (hasHydrated.current) {
      return;
    }

    initializeSettingsSyncPreferences();
    hasHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydrated.current) {
      return;
    }

    void ensureSettingsSyncStarted({
      isAuthenticated,
      isPro: isPro === true,
    });
  }, [isAuthenticated, isPro]);
}

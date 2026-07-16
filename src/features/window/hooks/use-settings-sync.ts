import { useEffect, useRef } from "react";
import {
  ensureSettingsSyncStarted,
  initializeSettingsSyncPreferences,
} from "@/features/settings/lib/settings-sync";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";

export function useSettingsSync() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasHydrated = useRef(false);
  const hasSettingsSync = hasProductCapability(subscription, "settingsSync");

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
      isPro: hasSettingsSync,
    });
  }, [hasSettingsSync, isAuthenticated]);
}

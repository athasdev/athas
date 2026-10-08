import { useEffect, useRef } from "react";
import {
  ensureSettingsSyncStarted,
  initializeSettingsSyncPreferences,
} from "@/features/settings/lib/settings-sync";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { hasProductCapability } from "@/features/auth/services/product-capabilities";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

export function useSettingsSync() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasHydrated = useRef(false);
  const hasSettingsSync = hasProductCapability(subscription, "settingsSync");
  // Without the saved settings, a sync would push the defaults over the cloud copy.
  const settingsLoaded = useSettingsStore((state) => state.isLoaded);

  useEffect(() => {
    if (hasHydrated.current) {
      return;
    }

    initializeSettingsSyncPreferences();
    hasHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydrated.current || !settingsLoaded) {
      return;
    }

    void ensureSettingsSyncStarted({
      isAuthenticated,
      isPro: hasSettingsSync,
    });
  }, [hasSettingsSync, isAuthenticated, settingsLoaded]);
}

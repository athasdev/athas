import { useEffect, useRef } from "react";
import {
  ensureSettingsSyncStarted,
  initializeSettingsSyncPreferences,
} from "@/features/settings/lib/settings-sync";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";

export function useSettingsSync() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const hasHydrated = useRef(false);
  const hasSettingsSync = hasProductCapability(subscription, "settingsSync");

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

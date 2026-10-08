import { useSyncExternalStore } from "react";
import {
  getSystemThemePreference,
  resolveEffectiveTheme,
  subscribeSystemThemePreference,
} from "@/features/settings/services/theme-resolution";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { Theme } from "@/features/settings/types/settings.types";

/** The theme the app renders with, following the OS appearance when system sync is on. */
export function useEffectiveTheme(): Theme {
  const systemTheme = useSyncExternalStore(
    subscribeSystemThemePreference,
    getSystemThemePreference,
  );
  return useSettingsStore((state) => resolveEffectiveTheme(state.settings, systemTheme));
}

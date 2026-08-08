import { invoke } from "@tauri-apps/api/core";
import isEqual from "fast-deep-equal";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { applySettingsSideEffects } from "@/features/settings/lib/settings-effects";
import { normalizeSettings } from "@/features/settings/lib/settings-normalization";
import { getSystemThemePreference } from "@/features/settings/lib/theme-resolution";
import {
  loadSettingsFromStore,
  saveSettingsToStore,
} from "@/features/settings/lib/settings-persistence";
import type { Settings } from "@/features/settings/types/settings.types";

async function detectInitialTheme() {
  let detectedTheme = getSystemThemePreference() === "dark" ? "athas-dark" : "athas-light";

  try {
    const tauriDetectedTheme = await invoke<string>("get_system_theme");
    detectedTheme = tauriDetectedTheme === "dark" ? "athas-dark" : "athas-light";
  } catch {
    console.log("Tauri theme detection not available, using browser detection");
  }

  return detectedTheme;
}

async function resolveInitialSettings(): Promise<{
  settings: Settings;
  shouldPersist: boolean;
}> {
  if (typeof window === "undefined") {
    return { settings: defaultSettings, shouldPersist: false };
  }

  const loadedSettings = await loadSettingsFromStore();
  let detectedTheme = false;

  if (!loadedSettings.theme) {
    loadedSettings.theme = await detectInitialTheme();
    detectedTheme = true;
  }

  const settings = normalizeSettings(loadedSettings);
  return {
    settings,
    shouldPersist: detectedTheme || !isEqual(settings, loadedSettings),
  };
}

export async function initializeSettingsState(
  applySettings: (settings: Settings) => void,
): Promise<Settings> {
  try {
    const { settings, shouldPersist } = await resolveInitialSettings();
    applySettingsSideEffects(settings);
    applySettings(settings);
    if (shouldPersist) await saveSettingsToStore(settings);
    return settings;
  } catch (error) {
    console.error("Failed to initialize settings:", error);
    return defaultSettings;
  }
}

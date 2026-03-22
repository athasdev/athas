import { invoke } from "@tauri-apps/api/core";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { applySettingsSideEffects } from "@/features/settings/lib/settings-effects";
import { normalizeSettings } from "@/features/settings/lib/settings-normalization";
import {
  loadSettingsFromStore,
  saveSettingsToStore,
} from "@/features/settings/lib/settings-persistence";
import type { Settings } from "@/features/settings/types/settings";

function getSystemThemePreference(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }

  return "dark";
}

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

export async function resolveInitialSettings(): Promise<Settings> {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  const loadedSettings = await loadSettingsFromStore();

  if (!loadedSettings.theme) {
    loadedSettings.theme = await detectInitialTheme();
  }

  return normalizeSettings(loadedSettings);
}

export async function initializeSettingsState(
  applySettings: (settings: Settings) => void,
): Promise<Settings> {
  try {
    const normalizedSettings = await resolveInitialSettings();
    applySettingsSideEffects(normalizedSettings);
    applySettings(normalizedSettings);
    await saveSettingsToStore(normalizedSettings);
    return normalizedSettings;
  } catch (error) {
    console.error("Failed to initialize settings:", error);
    return defaultSettings;
  }
}

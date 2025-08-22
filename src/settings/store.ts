import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { CoreFeaturesState } from "./models/feature.types";

type Theme = string;

interface Settings {
  // General
  autoSave: boolean;
  sidebarPosition: "left" | "right";
  mouseWheelZoom: boolean;
  // Editor
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  // Theme
  theme: Theme;
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  // Keyboard
  //  > nothing here, yet
  // Language
  defaultLanguage: string;
  autoDetectLanguage: boolean;
  formatOnSave: boolean;
  formatter: string;
  autoCompletion: boolean;
  parameterHints: boolean;
  // Features
  coreFeatures: CoreFeaturesState;
  // Advanced
  //  > nothing here, yet
  // Other
  extensionsActiveTab: "all" | "core" | "language-server" | "theme";
  maxOpenTabs: number;
  //// File tree
  hiddenFilePatterns: string[];
  hiddenDirectoryPatterns: string[];
}

const defaultSettings: Settings = {
  // General
  autoSave: true,
  sidebarPosition: "left",
  mouseWheelZoom: false,
  // Editor
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  // Theme
  theme: "athas-dark", // Changed from "auto" since we don't support continuous monitoring
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  // AI
  aiProviderId: "openai",
  aiModelId: "gpt-4o-mini",
  aiChatWidth: 400,
  isAIChatVisible: false,
  aiCompletion: true,
  // Keyboard
  //  > nothing here, yet
  // Language
  defaultLanguage: "auto",
  autoDetectLanguage: true,
  formatOnSave: false,
  formatter: "prettier",
  autoCompletion: true,
  parameterHints: true,
  // Features
  coreFeatures: {
    git: true,
    remote: true,
    terminal: true,
    search: true,
    diagnostics: true,
    aiChat: true,
    breadcrumbs: true,
  },
  // Advanced
  //  > nothing here, yet
  // Other
  extensionsActiveTab: "all",
  maxOpenTabs: 10,
  //// File tree
  hiddenFilePatterns: [],
  hiddenDirectoryPatterns: [],
};

// Theme class constants
const ALL_THEME_CLASSES = ["force-athas-light", "force-athas-dark"];

let storeInstance: Store;

const getStore = async () => {
  if (!storeInstance) {
    storeInstance = await load("settings.json", {
      autoSave: true,
    });

    // Initialize defaults if not present
    for (const [key, value] of Object.entries(defaultSettings)) {
      const current = await storeInstance.get(key);
      if (current === null || current === undefined) {
        await storeInstance.set(key, value);
      }
    }
    await storeInstance.save();
  }
  return storeInstance;
};

const saveSettingsToStore = async (settings: Partial<Settings>) => {
  try {
    const store = await getStore();

    // Map through and set each setting
    for (const [key, value] of Object.entries(settings)) {
      await store.set(key, value);
    }

    await store.save();
  } catch (error) {
    console.error("Failed to save settings to store:", error);
  }
};

// Apply theme to document
const applyTheme = async (theme: Theme) => {
  if (typeof window === "undefined") return;

  // Handle auto theme by detecting system preference
  if (theme === "auto") {
    const systemTheme = getSystemThemePreference();
    // For auto theme, use the default light/dark behavior
    ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
    document.documentElement.classList.add(
      systemTheme === "dark" ? "force-athas-dark" : "force-athas-light",
    );
    return;
  }

  // For TOML themes, use the theme registry
  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");
    console.log(`Settings store: Attempting to apply theme "${theme}"`);

    // Check if theme registry is ready
    if (!themeRegistry.isRegistryReady()) {
      console.log("Settings store: Theme registry not ready, waiting...");
      themeRegistry.onReady(() => {
        console.log("Settings store: Theme registry ready, applying theme");
        themeRegistry.applyTheme(theme);
      });
      return;
    }

    themeRegistry.applyTheme(theme);
  } catch (error) {
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
};

// Fallback theme application using CSS classes
const applyFallbackTheme = (theme: Theme) => {
  console.log(`Settings store: Falling back to class-based theme "${theme}"`);
  ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
  const themeClass = `force-${theme}`;
  document.documentElement.classList.add(themeClass);
};

// Get system theme preference
const getSystemThemePreference = (): "light" | "dark" => {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }
  return "dark";
};

// Initialize settings from localStorage
const getInitialSettings = async (): Promise<Settings> => {
  if (typeof window === "undefined") return defaultSettings;

  const store = await getStore();
  const loadedSettings: Settings = { ...defaultSettings };

  // Load each setting from the store
  for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
    const value = await store.get(key);
    if (value !== null && value !== undefined) {
      (loadedSettings as any)[key] = value as Settings[typeof key];
    }
  }

  const hasStoredTheme = await store.get("theme");
  if (!hasStoredTheme) {
    // No theme found, detect OS theme for better default
    let detectedTheme = getSystemThemePreference() === "dark" ? "athas-dark" : "athas-light";

    // Get more accurate theme detection from Tauri
    try {
      // Try to get more accurate theme detection from Tauri
      const tauriDetectedTheme = await invoke<string>("get_system_theme");
      detectedTheme = tauriDetectedTheme === "dark" ? "athas-dark" : "athas-light";
    } catch {
      console.log("Tauri theme detection not available, using browser detection");
    }

    loadedSettings.theme = detectedTheme;
    await saveSettingsToStore(loadedSettings);
  }

  return loadedSettings;
};

const initializeSettings = async () => {
  if (typeof window !== "undefined") {
    try {
      const loadedSettings = await getInitialSettings();
      applyTheme(loadedSettings.theme);

      const store = useSettingsStore.getState();
      store.initializeSettings(loadedSettings);
    } catch (error) {
      console.error("Failed to initialize settings:", error);
    }
  }
};

initializeSettings();

export const useSettingsStore = create(
  immer(
    combine(
      {
        settings: defaultSettings,
      },
      (set) => ({
        // Update settings from JSON string
        updateSettingsFromJSON: (jsonString: string): boolean => {
          try {
            const parsedSettings = JSON.parse(jsonString);
            const validatedSettings = { ...defaultSettings, ...parsedSettings };

            set((state) => {
              state.settings = validatedSettings;
            });

            void saveSettingsToStore(validatedSettings);
            return true;
          } catch (error) {
            console.error("Error parsing settings JSON:", error);
            return false;
          }
        },

        initializeSettings: (loadedSettings: Settings) => {
          set((state) => {
            state.settings = loadedSettings;
          });
        },

        // Update individual setting
        updateSetting: async <K extends keyof Settings>(key: K, value: Settings[K]) => {
          console.log(`Updating setting ${key} to:`, value);
          set((state) => {
            state.settings[key] = value;
          });

          if (key === "theme") applyTheme(value as Theme);

          await saveSettingsToStore({ [key]: value });
        },
      }),
    ),
  ),
);

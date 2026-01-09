import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { settingsSearchIndex } from "./config/search-index";
import type { CoreFeaturesState } from "./types/feature";
import type { SearchResult, SearchState } from "./types/search";

type Theme = string;

interface Settings {
  // General
  autoSave: boolean;
  sidebarPosition: "left" | "right";
  mouseWheelZoom: boolean;
  commandBarPreview: boolean;
  // Editor
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  // Terminal
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalLetterSpacing: number;
  terminalCursorStyle: "block" | "underline" | "bar";
  terminalCursorBlink: boolean;
  // UI
  uiFontFamily: string;
  // Theme
  theme: Theme;
  iconTheme: string;
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  nativeMenuBar: boolean;
  compactMenuBar: boolean;
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  aiAutoOpenReadFiles: boolean;
  aiTemperature: number;
  aiMaxTokens: number;
  aiDefaultOutputStyle: "default" | "explanatory" | "learning";
  aiDefaultSessionMode: string;
  // Layout
  sidebarWidth: number;
  // Keyboard
  vimMode: boolean;
  vimRelativeLineNumbers: boolean;
  // Language
  defaultLanguage: string;
  autoDetectLanguage: boolean;
  formatOnSave: boolean;
  formatter: string;
  lintOnSave: boolean;
  autoCompletion: boolean;
  parameterHints: boolean;
  // External Editor
  externalEditor: "none" | "nvim" | "helix" | "vim" | "nano" | "emacs" | "custom";
  customEditorCommand: string;
  // Features
  coreFeatures: CoreFeaturesState;
  // Advanced
  //  > nothing here, yet
  // Other
  extensionsActiveTab:
    | "all"
    | "core"
    | "language"
    | "theme"
    | "icon-theme"
    | "snippet"
    | "database";
  maxOpenTabs: number;
  //// File tree
  hiddenFilePatterns: string[];
  hiddenDirectoryPatterns: string[];
  //// Command Bar
  commandBarFileLimit: number;
}

const defaultSettings: Settings = {
  // General
  autoSave: true,
  sidebarPosition: "left",
  mouseWheelZoom: false,
  commandBarPreview: true,
  // Editor
  fontFamily: "Menlo, Consolas, Liberation Mono, monospace",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  // Terminal
  terminalFontFamily: "Menlo, Consolas, Liberation Mono, monospace",
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalLetterSpacing: 0,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  // UI
  uiFontFamily: "Menlo, Consolas, Liberation Mono, monospace",
  // Theme
  theme: "one-dark", // Changed from "auto" since we don't support continuous monitoring
  iconTheme: "colorful-material",
  autoThemeLight: "one-light",
  autoThemeDark: "one-dark",
  nativeMenuBar: false,
  compactMenuBar: true,
  // AI
  aiProviderId: "openai",
  aiModelId: "gpt-4o-mini",
  aiChatWidth: 400,
  isAIChatVisible: false,
  aiCompletion: true,
  aiAutoOpenReadFiles: true,
  aiTemperature: 0.7,
  aiMaxTokens: 4096,
  aiDefaultOutputStyle: "default",
  aiDefaultSessionMode: "",
  // Layout
  sidebarWidth: 220,
  // Keyboard
  vimMode: false,
  vimRelativeLineNumbers: false,
  // Language
  defaultLanguage: "auto",
  autoDetectLanguage: true,
  formatOnSave: false,
  formatter: "prettier",
  lintOnSave: false,
  autoCompletion: true,
  parameterHints: true,
  // External Editor
  externalEditor: "none",
  customEditorCommand: "",
  // Features
  coreFeatures: {
    git: true,
    github: true,
    remote: true,
    terminal: true,
    search: true,
    diagnostics: true,
    aiChat: true,
    breadcrumbs: true,
    persistentCommands: true,
  },
  // Advanced
  //  > nothing here, yet
  // Other
  extensionsActiveTab: "all",
  maxOpenTabs: 10,
  //// File tree
  hiddenFilePatterns: [],
  hiddenDirectoryPatterns: [],
  //// Command Bar
  commandBarFileLimit: 2000,
};

// Theme class constants
const ALL_THEME_CLASSES = ["force-one-light", "force-one-dark"];

let storeInstance: Store;

const getStore = async () => {
  if (!storeInstance) {
    storeInstance = await load("settings.json", { autoSave: true } as Parameters<typeof load>[1]);

    // Initialize defaults if not present, merge nested objects
    for (const [key, value] of Object.entries(defaultSettings)) {
      const current = await storeInstance.get(key);
      if (current === null || current === undefined) {
        await storeInstance.set(key, value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        // Merge nested objects to add new keys from defaults
        const merged = { ...value, ...current };
        await storeInstance.set(key, merged);
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

const applyTheme = async (theme: Theme) => {
  if (typeof window === "undefined") return;

  // Use the theme registry
  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");

    // Check if theme registry is ready
    if (!themeRegistry.isRegistryReady()) {
      themeRegistry.onReady(() => {
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

const initializeSettings = async () => {
  if (typeof window === "undefined") return defaultSettings;

  try {
    const store = await getStore();
    const loadedSettings: Settings = { ...defaultSettings };

    // Load settings from store
    for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
      const value = await store.get(key);
      if (value !== null && value !== undefined) {
        (loadedSettings as any)[key] = value as Settings[typeof key];
      }
    }

    // Detect theme if none exists
    if (!loadedSettings.theme) {
      let detectedTheme = getSystemThemePreference() === "dark" ? "one-dark" : "one-light";

      try {
        const tauriDetectedTheme = await invoke<string>("get_system_theme");
        detectedTheme = tauriDetectedTheme === "dark" ? "one-dark" : "one-light";
      } catch {
        console.log("Tauri theme detection not available, using browser detection");
      }

      loadedSettings.theme = detectedTheme;
    }

    applyTheme(loadedSettings.theme);

    // Update Zustand store
    useSettingsStore.getState().initializeSettings(loadedSettings);
    await saveSettingsToStore(loadedSettings);

    return loadedSettings;
  } catch (error) {
    console.error("Failed to initialize settings:", error);
    return defaultSettings;
  }
};

initializeSettings();

export const useSettingsStore = create(
  immer(
    combine(
      {
        settings: defaultSettings,
        search: {
          query: "",
          results: [] as SearchResult[],
          isSearching: false,
          selectedResultId: null,
        } as SearchState,
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

        // Search actions
        setSearchQuery: (query: string) => {
          set((state) => {
            state.search.query = query;
          });
          // Trigger search automatically when query changes
          useSettingsStore.getState().runSearch();
        },

        runSearch: () => {
          const query = useSettingsStore.getState().search.query.trim().toLowerCase();

          if (!query) {
            set((state) => {
              state.search.results = [];
              state.search.isSearching = false;
            });
            return;
          }

          set((state) => {
            state.search.isSearching = true;
          });

          // Normalize and search
          const normalizedQuery = query
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

          const tokens = normalizedQuery.split(/\s+/);

          const results: SearchResult[] = settingsSearchIndex
            .map((record) => {
              const searchableText = [
                record.label,
                record.description,
                record.section,
                ...(record.keywords || []),
              ]
                .join(" ")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase();

              let score = 0;

              // Check each token
              for (const token of tokens) {
                if (searchableText.includes(token)) {
                  // Boost score if token matches label
                  if (record.label.toLowerCase().includes(token)) {
                    score += 10;
                  }
                  // Boost score if token matches keywords
                  if (record.keywords?.some((kw) => kw.toLowerCase().includes(token))) {
                    score += 5;
                  }
                  // Regular match in description or section
                  score += 1;
                }
              }

              return { ...record, score };
            })
            .filter((result) => result.score > 0)
            .sort((a, b) => b.score - a.score);

          set((state) => {
            state.search.results = results;
            state.search.isSearching = false;
          });
        },

        clearSearch: () => {
          set((state) => {
            state.search.query = "";
            state.search.results = [];
            state.search.isSearching = false;
            state.search.selectedResultId = null;
          });
        },

        selectSearchResult: (resultId: string) => {
          set((state) => {
            state.search.selectedResultId = resultId;
          });
        },
      }),
    ),
  ),
);

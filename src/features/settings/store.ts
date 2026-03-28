import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  type ChatCompactionPolicy,
  normalizeChatCompactionPolicy,
} from "@/features/ai/lib/chat-compaction-policy";
import type { HarnessRuntimeBackend } from "@/features/ai/lib/harness-runtime-backend";
import { getProviderById } from "@/features/ai/types/providers";
import { settingsSearchIndex } from "./config/search-index";
import { cacheFontsForBootstrap, cacheThemeForBootstrap } from "./lib/appearance-bootstrap";
import { normalizeUiFontSize, UI_FONT_SIZE_DEFAULT } from "./lib/ui-font-size";
import type { CoreFeaturesState } from "./types/feature";
import type { SearchResult, SearchState } from "./types/search";

type Theme = string;

const DEFAULT_AI_PROVIDER_ID = "anthropic";
const DEFAULT_AI_MODEL_ID = "claude-sonnet-4-6";
const DEFAULT_AI_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";

const AI_MODEL_MIGRATIONS: Record<string, Record<string, string>> = {
  anthropic: {
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  gemini: {
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-2.5-flash": "gemini-3-flash-preview",
    "gemini-2.5-flash-lite": "gemini-3-flash-preview",
    "gemini-2.0-flash": "gemini-3-flash-preview",
  },
  openai: {
    "o1-mini": "o3-mini",
  },
  openrouter: {
    "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.6",
    "google/gemini-3-pro-preview": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-pro": "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash": "google/gemini-3-flash-preview",
  },
};

const AI_AUTOCOMPLETE_MODEL_MIGRATIONS: Record<string, string> = {
  "google/gemini-2.5-flash-lite": "google/gemini-3-flash-preview",
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export interface Settings {
  // General
  autoSave: boolean;
  sidebarPosition: "left" | "right";
  quickOpenPreview: boolean;
  // Editor
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  showMinimap: boolean;
  // Terminal
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalLetterSpacing: number;
  terminalScrollback: number;
  terminalCursorStyle: "block" | "underline" | "bar";
  terminalCursorBlink: boolean;
  terminalCursorWidth: number;
  terminalDefaultShellId: string;
  terminalDefaultProfileId: string;
  // UI
  uiFontFamily: string;
  uiFontSize: number;
  // Theme
  theme: Theme;
  iconTheme: string;
  syncSystemTheme: boolean;
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  nativeMenuBar: boolean;
  compactMenuBar: boolean;
  titleBarProjectMode: "tabs" | "window";
  openFoldersInNewWindow: boolean;
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  aiAutoCompactionPolicy: ChatCompactionPolicy;
  aiAutoCompactionReserveTokens: number;
  aiAutoCompactionKeepRecentTokens: number;
  aiAutocompleteModelId: string;
  aiDefaultSessionMode: string;
  aiPiHarnessBackend: HarnessRuntimeBackend;
  ollamaBaseUrl: string;
  // Layout
  sidebarWidth: number;
  showGitHubPullRequests: boolean;
  showGitHubIssues: boolean;
  showGitHubActions: boolean;
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
  enterpriseManagedMode: boolean;
  enterpriseRequireExtensionAllowlist: boolean;
  enterpriseAllowedExtensionIds: string[];
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
  horizontalTabScroll: boolean;
  //// File tree
  hiddenFilePatterns: string[];
  hiddenDirectoryPatterns: string[];
  gitChangesFolderView: boolean;
  confirmBeforeDiscard: boolean;
  autoRefreshGitStatus: boolean;
  showUntrackedFiles: boolean;
  showStagedFirst: boolean;
  gitDefaultDiffView: "unified" | "split";
  openDiffOnClick: boolean;
  showGitStatusInFileTree: boolean;
  compactGitStatusBadges: boolean;
  collapseEmptyGitSections: boolean;
  rememberLastGitPanelMode: boolean;
  gitLastPanelMode: "changes" | "stash" | "history" | "worktrees";
  enableInlineGitBlame: boolean;
  enableGitGutter: boolean;
}

type SettingsWithLegacyAutoCompaction = Settings & {
  aiAutoCompaction?: boolean;
};

const normalizeAISettings = (
  settings: SettingsWithLegacyAutoCompaction,
  explicitAutoCompactionPolicy: string | null | undefined = settings.aiAutoCompactionPolicy,
): Settings => {
  const normalizedSettings = { ...settings };
  const provider =
    getProviderById(normalizedSettings.aiProviderId) || getProviderById(DEFAULT_AI_PROVIDER_ID);

  if (!provider) {
    return {
      ...normalizedSettings,
      aiProviderId: DEFAULT_AI_PROVIDER_ID,
      aiModelId: DEFAULT_AI_MODEL_ID,
      aiAutocompleteModelId:
        AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
        normalizedSettings.aiAutocompleteModelId ||
        DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
    };
  }

  normalizedSettings.aiProviderId = provider.id;
  normalizedSettings.aiModelId =
    AI_MODEL_MIGRATIONS[provider.id]?.[normalizedSettings.aiModelId] ||
    normalizedSettings.aiModelId;

  if (
    provider.models.length > 0 &&
    !provider.models.some((model) => model.id === normalizedSettings.aiModelId)
  ) {
    normalizedSettings.aiModelId = provider.models[0].id;
  }

  normalizedSettings.aiAutocompleteModelId =
    AI_AUTOCOMPLETE_MODEL_MIGRATIONS[normalizedSettings.aiAutocompleteModelId] ||
    normalizedSettings.aiAutocompleteModelId ||
    DEFAULT_AI_AUTOCOMPLETE_MODEL_ID;
  normalizedSettings.aiAutoCompactionPolicy = normalizeChatCompactionPolicy(
    explicitAutoCompactionPolicy,
    settings.aiAutoCompaction,
  );

  normalizedSettings.aiAutoCompactionReserveTokens = clampNumber(
    Math.round(normalizedSettings.aiAutoCompactionReserveTokens || 16384),
    1024,
    262144,
  );
  normalizedSettings.aiAutoCompactionKeepRecentTokens = clampNumber(
    Math.round(normalizedSettings.aiAutoCompactionKeepRecentTokens || 20000),
    1024,
    262144,
  );

  return normalizedSettings;
};

const defaultSettings: Settings = {
  // General
  autoSave: true,
  sidebarPosition: "left",
  quickOpenPreview: true,
  // Editor
  fontFamily: "Geist Mono Variable",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  showMinimap: false,
  // Terminal
  terminalFontFamily: "Geist Mono Variable",
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalLetterSpacing: 0,
  terminalScrollback: 10000,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalCursorWidth: 2,
  terminalDefaultShellId: "",
  terminalDefaultProfileId: "",
  // UI
  uiFontFamily: "Geist Variable",
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  // Theme
  theme: "athas-dark", // Changed from "auto" since we don't support continuous monitoring
  iconTheme: "colorful-material",
  syncSystemTheme: false,
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  nativeMenuBar: false,
  compactMenuBar: true,
  titleBarProjectMode: "tabs",
  openFoldersInNewWindow: false,
  // AI
  aiProviderId: DEFAULT_AI_PROVIDER_ID,
  aiModelId: DEFAULT_AI_MODEL_ID,
  aiChatWidth: 400,
  isAIChatVisible: false,
  aiCompletion: true,
  aiAutoCompactionPolicy: "threshold_and_overflow",
  aiAutoCompactionReserveTokens: 16384,
  aiAutoCompactionKeepRecentTokens: 20000,
  aiAutocompleteModelId: DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  aiDefaultSessionMode: "",
  aiPiHarnessBackend: "pi-native",
  ollamaBaseUrl: "http://localhost:11434",
  // Layout
  sidebarWidth: 220,
  showGitHubPullRequests: true,
  showGitHubIssues: true,
  showGitHubActions: true,
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
  enterpriseManagedMode: false,
  enterpriseRequireExtensionAllowlist: false,
  enterpriseAllowedExtensionIds: [],
  // Other
  extensionsActiveTab: "all",
  maxOpenTabs: 10,
  horizontalTabScroll: false,
  //// File tree
  hiddenFilePatterns: [],
  hiddenDirectoryPatterns: [],
  gitChangesFolderView: true,
  confirmBeforeDiscard: true,
  autoRefreshGitStatus: true,
  showUntrackedFiles: true,
  showStagedFirst: true,
  gitDefaultDiffView: "unified",
  openDiffOnClick: true,
  showGitStatusInFileTree: true,
  compactGitStatusBadges: false,
  collapseEmptyGitSections: false,
  rememberLastGitPanelMode: false,
  gitLastPanelMode: "changes",
  enableInlineGitBlame: true,
  enableGitGutter: true,
};

export const getDefaultSetting = <K extends keyof Settings>(key: K): Settings[K] =>
  defaultSettings[key];

const AI_CHAT_TOGGLE_COOLDOWN_MS = 120;

// Theme class constants
const ALL_THEME_CLASSES = [
  "force-athas-light",
  "force-athas-dark",
  "force-vitesse-light",
  "force-vitesse-dark",
];

let storeInstance: Store;

const getStore = async () => {
  if (!storeInstance) {
    storeInstance = await load("settings.json", { autoSave: true } as Parameters<typeof load>[1]);

    // Initialize defaults if not present, merge nested objects
    for (const [key, value] of Object.entries(defaultSettings)) {
      const current = await storeInstance.get(key);
      if (current === null || current === undefined) {
        if (key === "aiAutoCompactionPolicy") {
          const legacyAutoCompaction = await storeInstance.get("aiAutoCompaction");
          await storeInstance.set(
            key,
            normalizeChatCompactionPolicy(
              null,
              typeof legacyAutoCompaction === "boolean" ? legacyAutoCompaction : undefined,
            ),
          );
        } else {
          await storeInstance.set(key, value);
        }
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

// Debounced version to prevent excessive disk writes
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: Partial<Settings> = {};

const debouncedSaveSettingsToStore = (settings: Partial<Settings>) => {
  // Merge pending settings
  pendingSettings = { ...pendingSettings, ...settings };

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    const settingsToSave = pendingSettings;
    pendingSettings = {};
    saveTimeout = null;
    saveSettingsToStore(settingsToSave);
  }, 300);
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
        const appliedTheme = themeRegistry.getTheme(theme);
        if (appliedTheme) {
          cacheThemeForBootstrap(appliedTheme);
        }
      });
      return;
    }

    themeRegistry.applyTheme(theme);
    const appliedTheme = themeRegistry.getTheme(theme);
    if (appliedTheme) {
      cacheThemeForBootstrap(appliedTheme);
    }
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
    const loadedSettings: SettingsWithLegacyAutoCompaction = { ...defaultSettings };

    // Load settings from store
    for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
      const value = await store.get(key);
      if (value !== null && value !== undefined) {
        (loadedSettings as any)[key] = value as Settings[typeof key];
      }
    }

    const legacyAutoCompaction = await store.get("aiAutoCompaction");
    if (typeof legacyAutoCompaction === "boolean") {
      loadedSettings.aiAutoCompaction = legacyAutoCompaction;
    }
    const storedAutoCompactionPolicy = await store.get("aiAutoCompactionPolicy");

    // Detect theme if none exists
    if (!loadedSettings.theme) {
      let detectedTheme = getSystemThemePreference() === "dark" ? "athas-dark" : "athas-light";

      try {
        const tauriDetectedTheme = await invoke<string>("get_system_theme");
        detectedTheme = tauriDetectedTheme === "dark" ? "athas-dark" : "athas-light";
      } catch {
        console.log("Tauri theme detection not available, using browser detection");
      }

      loadedSettings.theme = detectedTheme;
    }

    const normalizedSettings = normalizeAISettings(
      loadedSettings,
      typeof storedAutoCompactionPolicy === "string" ? storedAutoCompactionPolicy : null,
    );
    normalizedSettings.uiFontSize = normalizeUiFontSize(normalizedSettings.uiFontSize);

    applyTheme(normalizedSettings.theme);
    cacheFontsForBootstrap(
      normalizedSettings.fontFamily,
      normalizedSettings.uiFontFamily,
      normalizedSettings.uiFontSize,
    );

    // Sync Ollama base URL with provider
    if (normalizedSettings.ollamaBaseUrl) {
      import("@/utils/providers").then(({ setOllamaBaseUrl }) => {
        setOllamaBaseUrl(normalizedSettings.ollamaBaseUrl);
      });
    }

    // Update Zustand store
    useSettingsStore.getState().initializeSettings(normalizedSettings);
    await saveSettingsToStore(normalizedSettings);

    return normalizedSettings;
  } catch (error) {
    console.error("Failed to initialize settings:", error);
    return defaultSettings;
  }
};

const settingsInitializationPromise = initializeSettings();

export const waitForSettingsInitialization = () => settingsInitializationPromise;
export const initializeSettingsStore = waitForSettingsInitialization;

export const useSettingsStore = create(
  immer(
    combine(
      {
        settings: defaultSettings,
        _lastAiChatToggleAt: 0,
        search: {
          query: "",
          results: [] as SearchResult[],
          isSearching: false,
          selectedResultId: null,
        } as SearchState,
      },
      (set, get) => ({
        // Update settings from JSON string
        updateSettingsFromJSON: (jsonString: string): boolean => {
          try {
            const parsedSettings = JSON.parse(jsonString);
            const parsedAutoCompactionPolicy =
              typeof parsedSettings === "object" &&
              parsedSettings !== null &&
              "aiAutoCompactionPolicy" in parsedSettings
                ? parsedSettings.aiAutoCompactionPolicy
                : null;
            const validatedSettings = normalizeAISettings(
              {
                ...defaultSettings,
                ...parsedSettings,
              },
              parsedAutoCompactionPolicy,
            );

            set((state) => {
              state.settings = validatedSettings;
            });

            validatedSettings.uiFontSize = normalizeUiFontSize(validatedSettings.uiFontSize);

            cacheFontsForBootstrap(
              validatedSettings.fontFamily,
              validatedSettings.uiFontFamily,
              validatedSettings.uiFontSize,
            );
            applyTheme(validatedSettings.theme);
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

        // Reset all settings to defaults
        resetToDefaults: async () => {
          set((state) => {
            state.settings = { ...defaultSettings };
          });

          applyTheme(defaultSettings.theme);
          cacheFontsForBootstrap(
            defaultSettings.fontFamily,
            defaultSettings.uiFontFamily,
            defaultSettings.uiFontSize,
          );
          await saveSettingsToStore(defaultSettings);
        },

        toggleHarnessEntry: (forceValue?: boolean) => {
          const now = Date.now();
          const previousToggleAt = get()._lastAiChatToggleAt;
          if (now - previousToggleAt < AI_CHAT_TOGGLE_COOLDOWN_MS) {
            return;
          }

          set((state) => {
            state.settings.isAIChatVisible = false;
            state._lastAiChatToggleAt = now;
          });

          debouncedSaveSettingsToStore({ isAIChatVisible: false });
          void Promise.all([
            import("@/features/editor/stores/buffer-store"),
            import("@/features/layout/components/footer/editor-footer-ai-entry"),
          ]).then(([{ useBufferStore }, { toggleHarnessFromAiChatToggle }]) => {
            const { buffers, activeBufferId, actions } = useBufferStore.getState();
            const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId) ?? null;
            const nextValue = forceValue !== undefined ? forceValue : !activeBuffer?.isAgent;

            toggleHarnessFromAiChatToggle(
              activeBuffer,
              actions.openAgentBuffer,
              actions.closeBuffer,
              nextValue,
              get().settings.aiPiHarnessBackend,
            );
          });
        },

        toggleAIChatVisible: (forceValue?: boolean) => {
          const now = Date.now();
          const previousToggleAt = get()._lastAiChatToggleAt;
          if (now - previousToggleAt < AI_CHAT_TOGGLE_COOLDOWN_MS) {
            return;
          }

          set((state) => {
            state.settings.isAIChatVisible = false;
            state._lastAiChatToggleAt = now;
          });

          debouncedSaveSettingsToStore({ isAIChatVisible: false });
          void Promise.all([
            import("@/features/editor/stores/buffer-store"),
            import("@/features/layout/components/footer/editor-footer-ai-entry"),
          ]).then(([{ useBufferStore }, { toggleHarnessFromAiChatToggle }]) => {
            const { buffers, activeBufferId, actions } = useBufferStore.getState();
            const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId) ?? null;
            const nextValue = forceValue !== undefined ? forceValue : !activeBuffer?.isAgent;

            toggleHarnessFromAiChatToggle(
              activeBuffer,
              actions.openAgentBuffer,
              actions.closeBuffer,
              nextValue,
              get().settings.aiPiHarnessBackend,
            );
          });
        },

        // Update individual setting
        updateSetting: async <K extends keyof Settings>(key: K, value: Settings[K]) => {
          const normalizedValue =
            key === "uiFontSize" ? (normalizeUiFontSize(value) as Settings[K]) : value;

          set((state) => {
            state.settings[key] = normalizedValue;
          });

          if (key === "theme") applyTheme(normalizedValue as Theme);
          if (key === "ollamaBaseUrl") {
            import("@/utils/providers").then(({ setOllamaBaseUrl }) => {
              setOllamaBaseUrl(normalizedValue as string);
            });
          }
          if (key === "fontFamily" || key === "uiFontFamily" || key === "uiFontSize") {
            const latestSettings = useSettingsStore.getState().settings;
            cacheFontsForBootstrap(
              latestSettings.fontFamily,
              latestSettings.uiFontFamily,
              latestSettings.uiFontSize,
            );
          }

          debouncedSaveSettingsToStore({ [key]: normalizedValue });
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

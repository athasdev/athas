import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  defaultSettings,
  getDefaultSetting,
  getDefaultSettingsSnapshot,
} from "@/features/settings/config/default-settings";
import {
  applySettingSideEffect,
  applySettingsSideEffects,
} from "@/features/settings/lib/settings-effects";
import { initializeSettingsState } from "@/features/settings/lib/settings-bootstrap";
import {
  normalizeSettingValue,
  normalizeSettings,
} from "@/features/settings/lib/settings-normalization";
import {
  debouncedSaveSettingsToStore,
  saveSettingsToStore,
} from "@/features/settings/lib/settings-persistence";
import { settingsSearchIndex } from "./config/search-index";
import type { SearchResult, SearchState } from "./types/search";
import type { Settings } from "./types/settings";

export type { Settings } from "./types/settings";

const AI_CHAT_TOGGLE_COOLDOWN_MS = 120;

let settingsStoreInitPromise: Promise<Settings> | null = null;

export function initializeSettingsStore(): Promise<Settings> {
  if (settingsStoreInitPromise) {
    return settingsStoreInitPromise;
  }

  settingsStoreInitPromise = initializeSettingsState((loadedSettings) => {
    useSettingsStore.getState().initializeSettings(loadedSettings);
  });

  return settingsStoreInitPromise;
}

export const useSettingsStore = create(
  immer(
    combine(
      {
        settings: getDefaultSettingsSnapshot(),
        _lastAiChatToggleAt: 0,
        search: {
          query: "",
          results: [] as SearchResult[],
          isSearching: false,
          selectedResultId: null,
        } as SearchState,
      },
      (set, get) => ({
        updateSettingsFromJSON: (jsonString: string): boolean => {
          try {
            const parsedSettings = JSON.parse(jsonString);
            const validatedSettings = normalizeSettings({
              ...getDefaultSettingsSnapshot(),
              ...parsedSettings,
            });

            set((state) => {
              state.settings = validatedSettings;
            });

            applySettingsSideEffects(validatedSettings);
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

        resetToDefaults: async () => {
          const nextSettings = getDefaultSettingsSnapshot();

          set((state) => {
            state.settings = nextSettings;
          });

          applySettingsSideEffects(nextSettings);
          await saveSettingsToStore(nextSettings);
        },

        toggleAIChatVisible: (forceValue?: boolean) => {
          const now = Date.now();
          const previousToggleAt = get()._lastAiChatToggleAt;
          if (now - previousToggleAt < AI_CHAT_TOGGLE_COOLDOWN_MS) {
            return;
          }

          const nextValue = forceValue !== undefined ? forceValue : !get().settings.isAIChatVisible;

          set((state) => {
            state.settings.isAIChatVisible = nextValue;
            state._lastAiChatToggleAt = now;
          });

          debouncedSaveSettingsToStore({ isAIChatVisible: nextValue });
        },

        updateSetting: async <K extends keyof Settings>(key: K, value: Settings[K]) => {
          const normalizedValue = normalizeSettingValue(key, value);

          set((state) => {
            state.settings[key] = normalizedValue;
          });

          applySettingSideEffect(key, normalizedValue, () => useSettingsStore.getState().settings);
          debouncedSaveSettingsToStore({ [key]: normalizedValue });
        },

        setSearchQuery: (query: string) => {
          set((state) => {
            state.search.query = query;
          });
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

              for (const token of tokens) {
                if (searchableText.includes(token)) {
                  if (record.label.toLowerCase().includes(token)) {
                    score += 10;
                  }
                  if (record.keywords?.some((kw) => kw.toLowerCase().includes(token))) {
                    score += 5;
                  }
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

export { defaultSettings, getDefaultSetting };

import { create } from "zustand";
import { searchSettings } from "@/features/settings/lib/settings-search";
import type { SearchState } from "@/features/settings/types/search.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface SettingsSearchStore extends SearchState {
  actions: {
    setQuery: (query: string) => void;
    clear: () => void;
    selectResult: (resultId: string) => void;
  };
}

/**
 * The Settings page search. Kept apart from the settings store so typing a query only
 * re-renders the search UI, not every component that reads a setting, and is never persisted.
 */
const useSettingsSearchStoreBase = create<SettingsSearchStore>()((set) => ({
  query: "",
  results: [],
  selectedResultId: null,
  actions: {
    setQuery: (query) => set({ query, results: searchSettings(query), selectedResultId: null }),
    clear: () => set({ query: "", results: [], selectedResultId: null }),
    selectResult: (resultId) => set({ selectedResultId: resultId }),
  },
}));

export const useSettingsSearchStore = createSelectors(useSettingsSearchStoreBase);

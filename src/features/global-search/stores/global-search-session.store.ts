import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { ContentSearchOptions } from "../types/global-search.types";

const DEFAULT_SEARCH_OPTIONS: ContentSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
};

const initialState = {
  query: "",
  replaceQuery: "",
  includeQuery: "",
  excludeQuery: "",
  searchOptions: DEFAULT_SEARCH_OPTIONS,
};

interface GlobalSearchSessionState {
  query: string;
  replaceQuery: string;
  includeQuery: string;
  excludeQuery: string;
  searchOptions: ContentSearchOptions;
  actions: {
    setQuery: (query: string) => void;
    setReplaceQuery: (replaceQuery: string) => void;
    setIncludeQuery: (includeQuery: string) => void;
    setExcludeQuery: (excludeQuery: string) => void;
    setSearchOption: <Key extends keyof ContentSearchOptions>(
      key: Key,
      value: ContentSearchOptions[Key],
    ) => void;
    reset: () => void;
  };
}

export const useGlobalSearchSessionStore = createSelectors(
  create<GlobalSearchSessionState>()((set) => ({
    ...initialState,
    actions: {
      setQuery: (query) => set({ query }),
      setReplaceQuery: (replaceQuery) => set({ replaceQuery }),
      setIncludeQuery: (includeQuery) => set({ includeQuery }),
      setExcludeQuery: (excludeQuery) => set({ excludeQuery }),
      setSearchOption: (key, value) => {
        set((state) => ({
          searchOptions: {
            ...state.searchOptions,
            [key]: value,
          },
        }));
      },
      reset: () => set(initialState),
    },
  })),
);

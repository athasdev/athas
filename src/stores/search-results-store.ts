import { create } from "zustand";
import { combine } from "zustand/middleware";
import type { SearchResult } from "@/features/layout/models/search";

export const useSearchResultsStore = create(
  combine(
    {
      searchResults: [] as SearchResult[],
      activePathsearchResults: [] as SearchResult[],
    },
    (set, get) => ({
      setSearchResults: (results: SearchResult[]) => set({ searchResults: results }),
      getSearchResults: () => get().searchResults,
      clearSearchResults: () => set({ searchResults: [] }),
      setActivePathSearchResults: (results: SearchResult[]) =>
        set({ activePathsearchResults: results }),
      getActivePathSearchResults: () => get().activePathsearchResults,
      clearActivePathSearchResults: () => set({ activePathsearchResults: [] }),
    }),
  ),
);

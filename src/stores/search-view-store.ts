import { create } from "zustand";
import type { SearchViewRef } from "@/components/search-view";

interface SearchViewStore {
  searchViewRef: SearchViewRef | null;
  setSearchViewRef: (ref: SearchViewRef | null) => void;
  focusSearchInput: () => void;
}

export const useSearchViewStore = create<SearchViewStore>((set, get) => ({
  searchViewRef: null,
  setSearchViewRef: (ref) => set({ searchViewRef: ref }),
  focusSearchInput: () => {
    const { searchViewRef } = get();
    if (searchViewRef) {
      searchViewRef.focusInput();
    }
  },
}));

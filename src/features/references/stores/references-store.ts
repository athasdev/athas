import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Reference, ReferencesQuery } from "../types/reference";

interface ReferencesState {
  references: Reference[];
  query: ReferencesQuery | null;
  isLoading: boolean;
  actions: {
    setReferences: (query: ReferencesQuery, references: Reference[]) => void;
    setIsLoading: (loading: boolean) => void;
    clear: () => void;
  };
}

export const useReferencesStore = createSelectors(
  create<ReferencesState>()((set) => ({
    references: [],
    query: null,
    isLoading: false,

    actions: {
      setReferences: (query: ReferencesQuery, references: Reference[]) => {
        set({ query, references, isLoading: false });
      },
      setIsLoading: (isLoading: boolean) => {
        set({ isLoading });
      },
      clear: () => {
        set({ references: [], query: null, isLoading: false });
      },
    },
  })),
);

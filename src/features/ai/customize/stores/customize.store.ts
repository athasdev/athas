import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { CustomizeSection, CustomizeTab } from "../types/customize.types";

interface CustomizeState {
  section: CustomizeSection;
  tabs: Record<CustomizeSection, CustomizeTab>;
  /** An installed item to scroll to and mark, picked from the navigation's Installed group. */
  revealedItemId: string | null;
  actions: {
    setSection: (section: CustomizeSection) => void;
    setTab: (section: CustomizeSection, tab: CustomizeTab) => void;
    reveal: (section: CustomizeSection, itemId: string) => void;
    clearReveal: () => void;
  };
}

const useCustomizeStoreBase = create<CustomizeState>()((set) => ({
  section: "mcp",
  tabs: { mcp: "catalog", agents: "catalog", skills: "catalog", extensions: "catalog" },
  revealedItemId: null,
  actions: {
    setSection: (section) => set({ section, revealedItemId: null }),
    setTab: (section, tab) => set((state) => ({ tabs: { ...state.tabs, [section]: tab } })),
    reveal: (section, itemId) =>
      set((state) => ({
        section,
        tabs: { ...state.tabs, [section]: "installed" },
        revealedItemId: itemId,
      })),
    clearReveal: () => set({ revealedItemId: null }),
  },
}));

export const useCustomizeStore = createSelectors(useCustomizeStoreBase);

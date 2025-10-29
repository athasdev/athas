import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface InlineEditToolbarState {
  isVisible: boolean;
  actions: {
    show: () => void;
    hide: () => void;
    toggle: () => void;
  };
}

const useInlineEditToolbarStoreBase = create<InlineEditToolbarState>((set) => ({
  isVisible: false,
  actions: {
    show: () => set({ isVisible: true }),
    hide: () => set({ isVisible: false }),
    toggle: () => set((state) => ({ isVisible: !state.isVisible })),
  },
}));

export const useInlineEditToolbarStore = createSelectors(useInlineEditToolbarStoreBase);

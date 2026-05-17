import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface InlineEditToolbarState {
  isVisible: boolean;
  targetViewKey: string | null;
  actions: {
    show: (targetViewKey?: string | null) => void;
    hide: () => void;
    toggle: (targetViewKey?: string | null) => void;
  };
}

const useInlineEditToolbarStoreBase = create<InlineEditToolbarState>((set) => ({
  isVisible: false,
  targetViewKey: null,
  actions: {
    show: (targetViewKey = null) => set({ isVisible: true, targetViewKey }),
    hide: () => set({ isVisible: false, targetViewKey: null }),
    toggle: (targetViewKey = null) =>
      set((state) => ({
        isVisible: !state.isVisible,
        targetViewKey: state.isVisible ? null : targetViewKey,
      })),
  },
}));

export const useInlineEditToolbarStore = createSelectors(useInlineEditToolbarStoreBase);

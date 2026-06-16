import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface InlineEditToolbarState {
  isVisible: boolean;
  targetViewKey: string | null;
  requestId: number;
  actions: {
    show: (targetViewKey?: string | null) => void;
    hide: () => void;
    toggle: (targetViewKey?: string | null) => void;
  };
}

const useInlineEditToolbarStoreBase = create<InlineEditToolbarState>((set) => ({
  isVisible: false,
  targetViewKey: null,
  requestId: 0,
  actions: {
    show: (targetViewKey = null) =>
      set((state) => ({ isVisible: true, targetViewKey, requestId: state.requestId + 1 })),
    hide: () => set({ isVisible: false, targetViewKey: null }),
    toggle: (targetViewKey = null) =>
      set((state) => ({
        isVisible: !state.isVisible,
        targetViewKey: state.isVisible ? null : targetViewKey,
        requestId: state.isVisible ? state.requestId : state.requestId + 1,
      })),
  },
}));

export const useInlineEditToolbarStore = createSelectors(useInlineEditToolbarStoreBase);

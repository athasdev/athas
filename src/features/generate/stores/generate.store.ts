import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface GenerateState {
  isExtensionGenerationVisible: boolean;
  actions: {
    openExtensionGeneration: () => void;
    closeExtensionGeneration: () => void;
  };
}

export const useGenerateStore = createSelectors(
  create<GenerateState>()((set) => ({
    isExtensionGenerationVisible: false,
    actions: {
      openExtensionGeneration: () => set({ isExtensionGenerationVisible: true }),
      closeExtensionGeneration: () => set({ isExtensionGenerationVisible: false }),
    },
  })),
);

import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface LocalHistoryState {
  targetPath: string | null;
  actions: {
    setTargetPath: (path: string | null) => void;
  };
}

export const useLocalHistoryStore = createSelectors(
  create<LocalHistoryState>()((set) => ({
    targetPath: null,
    actions: {
      setTargetPath: (path) => set({ targetPath: path }),
    },
  })),
);

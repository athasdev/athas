import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface MinimapState {
  scale: number;
  width: number;

  actions: {
    setScale: (scale: number) => void;
    setWidth: (width: number) => void;
  };
}

export const useMinimapStore = createSelectors(
  create<MinimapState>()(
    persist(
      (set) => ({
        scale: 0.15,
        width: 80,

        actions: {
          setScale: (scale) => set({ scale: Math.max(0.05, Math.min(0.3, scale)) }),
          setWidth: (width) => set({ width: Math.max(50, Math.min(150, width)) }),
        },
      }),
      {
        name: "editor-minimap",
        partialize: (state) => ({
          scale: state.scale,
          width: state.width,
        }),
      },
    ),
  ),
);

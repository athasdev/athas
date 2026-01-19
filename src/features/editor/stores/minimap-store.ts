import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface MinimapState {
  isEnabled: boolean;
  scale: number;
  width: number;

  actions: {
    setEnabled: (enabled: boolean) => void;
    setScale: (scale: number) => void;
    setWidth: (width: number) => void;
  };
}

export const useMinimapStore = createSelectors(
  create<MinimapState>()(
    persist(
      (set) => ({
        isEnabled: true,
        scale: 0.15,
        width: 80,

        actions: {
          setEnabled: (enabled) => set({ isEnabled: enabled }),
          setScale: (scale) => set({ scale: Math.max(0.05, Math.min(0.3, scale)) }),
          setWidth: (width) => set({ width: Math.max(50, Math.min(150, width)) }),
        },
      }),
      {
        name: "editor-minimap",
        partialize: (state) => ({
          isEnabled: state.isEnabled,
          scale: state.scale,
          width: state.width,
        }),
      },
    ),
  ),
);

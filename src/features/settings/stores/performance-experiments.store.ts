import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface PerformanceExperiments {
  webgpu: boolean;
  showMonitor: boolean;
  actions: {
    toggleWebgpu: () => void;
    toggleMonitor: () => void;
  };
}

export const usePerformanceExperiments = createSelectors(
  create<PerformanceExperiments>()(
    persist(
      (set) => ({
        webgpu: import.meta.env.DEV,
        showMonitor: import.meta.env.DEV,
        actions: {
          toggleWebgpu: () => set((state) => ({ webgpu: !state.webgpu })),
          toggleMonitor: () => set((state) => ({ showMonitor: !state.showMonitor })),
        },
      }),
      {
        name: "athas-performance-experiments",
        partialize: ({ webgpu, showMonitor }) => ({ webgpu, showMonitor }),
      },
    ),
  ),
);

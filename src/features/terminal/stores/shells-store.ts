import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Shell } from "../types/terminal";

interface TerminalShellsState {
  shells: Shell[];
  isLoading: boolean;
  hasLoaded: boolean;
  actions: {
    loadShells: () => Promise<void>;
  };
}

const useTerminalShellsStoreBase = create<TerminalShellsState>()((set, get) => ({
  shells: [],
  isLoading: false,
  hasLoaded: false,
  actions: {
    loadShells: async () => {
      const { isLoading, hasLoaded } = get();
      if (isLoading || hasLoaded) return;

      set({ isLoading: true });

      try {
        const shells = await invoke<Shell[]>("list_shells");
        set({
          shells,
          isLoading: false,
          hasLoaded: true,
        });
      } catch (error) {
        console.error("Failed to load terminal shells:", error);
        set({
          isLoading: false,
          hasLoaded: false,
        });
      }
    },
  },
}));

export const useTerminalShellsStore = createSelectors(useTerminalShellsStoreBase);

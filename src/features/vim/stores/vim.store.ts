import { create } from "zustand";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createSelectors } from "@/utils/zustand-selectors";

export type VimMode = "normal" | "insert" | "visual";

interface VimState {
  mode: VimMode;
  relativeLineNumbers: boolean;
  actions: {
    setMode: (mode: VimMode) => void;
    setRelativeLineNumbers: (enabled: boolean, options?: { persist?: boolean }) => void;
  };
}

export const useVimStore = createSelectors(
  create<VimState>()((set, get) => ({
    mode: "normal",
    relativeLineNumbers: false,
    actions: {
      setMode: (mode) => {
        if (get().mode !== mode) set({ mode });
      },
      setRelativeLineNumbers: (enabled, options) => {
        if (get().relativeLineNumbers === enabled) return;

        set({ relativeLineNumbers: enabled });
        if (options?.persist !== false) {
          void useSettingsStore.getState().updateSetting("vimRelativeLineNumbers", enabled);
        }
      },
    },
  })),
);

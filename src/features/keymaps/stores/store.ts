/**
 * Zustand store for keymaps
 * Manages keybindings and context state
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Keybinding, KeymapContext, KeymapStore } from "../types";

interface KeymapState extends KeymapStore {
  actions: {
    addKeybinding: (keybinding: Keybinding) => void;
    removeKeybinding: (commandId: string) => void;
    updateKeybinding: (commandId: string, updates: Partial<Keybinding>) => void;
    resetToDefaults: () => void;
    setContext: (key: keyof KeymapContext, value: boolean) => void;
    setContexts: (contexts: Partial<KeymapContext>) => void;
  };
}

const useKeymapStoreBase = create<KeymapState>()(
  persist(
    (set) => ({
      keybindings: [],
      contexts: {
        editorFocus: false,
        vimMode: false,
        vimNormalMode: false,
        vimInsertMode: false,
        vimVisualMode: false,
        terminalFocus: false,
        sidebarFocus: false,
        findWidgetVisible: false,
        hasSelection: false,
      },
      actions: {
        addKeybinding: (keybinding) =>
          set((state) => ({
            keybindings: [...state.keybindings, keybinding],
          })),
        removeKeybinding: (commandId) =>
          set((state) => ({
            keybindings: state.keybindings.filter((kb) => kb.command !== commandId),
          })),
        updateKeybinding: (commandId, updates) =>
          set((state) => ({
            keybindings: state.keybindings.map((kb) =>
              kb.command === commandId ? { ...kb, ...updates } : kb,
            ),
          })),
        resetToDefaults: () =>
          set(() => ({
            keybindings: [],
          })),
        setContext: (key, value) =>
          set((state) => ({
            contexts: { ...state.contexts, [key]: value },
          })),
        setContexts: (contexts) =>
          set((state) => ({
            contexts: { ...state.contexts, ...contexts },
          })),
      },
    }),
    {
      name: "keymaps-storage",
      partialize: (state) => ({
        keybindings: state.keybindings.filter((kb) => kb.source === "user"),
      }),
    },
  ),
);

export const useKeymapStore = createSelectors(useKeymapStoreBase);

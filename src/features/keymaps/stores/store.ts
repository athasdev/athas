/**
 * Zustand store for keymaps
 * Manages keybindings and context state
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Keybinding, KeymapContext, KeymapStore } from "../types";
import {
  getExportableUserKeybindings,
  normalizeUserKeybinding,
} from "../utils/keybinding-import-export";

interface KeymapState extends KeymapStore {
  recordingCommandId: string | null;
  actions: {
    addKeybinding: (keybinding: Keybinding) => void;
    removeKeybinding: (commandId: string) => void;
    updateKeybinding: (commandId: string, updates: Partial<Keybinding>) => void;
    resetToDefaults: () => void;
    setContext: (key: keyof KeymapContext, value: boolean) => void;
    setContexts: (contexts: Partial<KeymapContext>) => void;
    startRecording: (commandId: string) => void;
    stopRecording: () => void;
  };
}

const useKeymapStoreBase = create<KeymapState>()(
  persist(
    (set) => ({
      keybindings: [],
      recordingCommandId: null,
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
        isRecordingKeybinding: false,
      },
      actions: {
        addKeybinding: (keybinding) =>
          set((state) => {
            const userKeybinding = normalizeUserKeybinding(keybinding);

            if (!userKeybinding) {
              return state;
            }

            return {
              keybindings: [
                ...state.keybindings.filter((kb) => kb.command !== userKeybinding.command),
                userKeybinding,
              ],
            };
          }),
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
        startRecording: (commandId) =>
          set((state) => ({
            recordingCommandId: commandId,
            contexts: { ...state.contexts, isRecordingKeybinding: true },
          })),
        stopRecording: () =>
          set((state) => ({
            recordingCommandId: null,
            contexts: { ...state.contexts, isRecordingKeybinding: false },
          })),
      },
    }),
    {
      name: "keymaps-storage",
      partialize: (state) => ({
        keybindings: getExportableUserKeybindings(state.keybindings),
      }),
    },
  ),
);

export const useKeymapStore = createSelectors(useKeymapStoreBase);

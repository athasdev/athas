/**
 * Zustand store for keymaps
 * Manages keybindings and context state
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Keybinding, KeymapContext, KeymapStore } from "../types/keymaps.types";
import {
  getExportableUserKeybindings,
  mergeImportedUserKeybindings,
  normalizeUserKeybinding,
} from "../utils/keybinding-import-export";

interface KeymapState extends KeymapStore {
  recordingCommandId: string | null;
  actions: {
    addKeybinding: (keybinding: Keybinding) => void;
    importKeybindings: (keybindings: Keybinding[]) => void;
    removeKeybinding: (commandId: string) => void;
    resetToDefaults: () => void;
    setContext: (key: keyof KeymapContext, value: boolean) => void;
    setContexts: (contexts: Partial<KeymapContext>) => void;
    startRecording: (commandId: string) => void;
    stopRecording: () => void;
  };
}

const useKeymapStoreBase = create<KeymapState>()(
  persist(
    (set, get) => ({
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
        importKeybindings: (keybindings) =>
          set((state) => ({
            keybindings: mergeImportedUserKeybindings(state.keybindings, keybindings),
          })),
        removeKeybinding: (commandId) =>
          set((state) => ({
            keybindings: state.keybindings.filter((kb) => kb.command !== commandId),
          })),
        resetToDefaults: () =>
          set(() => ({
            keybindings: [],
          })),
        // Focus and selection events call these constantly. Skipping unchanged values before `set`
        // matters twice over: persist writes localStorage on every `set`, even a no-op one.
        setContext: (key, value) => {
          if (get().contexts[key] === value) return;
          set((state) => ({
            contexts: { ...state.contexts, [key]: value },
          }));
        },
        setContexts: (contexts) => {
          const current = get().contexts;
          const changed = Object.entries(contexts).some(
            ([key, value]) => current[key as keyof typeof current] !== value,
          );
          if (!changed) return;
          set((state) => ({
            contexts: { ...state.contexts, ...contexts },
          }));
        },
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

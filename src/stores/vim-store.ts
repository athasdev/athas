import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useSettingsStore } from "@/settings/store";
import { createSelectors } from "@/utils/zustand-selectors";

export type VimMode = "normal" | "insert" | "visual" | "command";

interface VimState {
  mode: VimMode;
  relativeLineNumbers: boolean;
  isCommandMode: boolean; // When user presses : in normal mode
  commandInput: string; // The command being typed after :
  lastCommand: string; // Store the last executed command
  lastKey: string | null; // For double key commands like dd, yy
  keyBuffer: string[]; // Buffer for multi-key commands (e.g., "3", "d", "w")
  visualSelection: {
    start: { line: number; column: number } | null;
    end: { line: number; column: number } | null;
  };
  visualMode: "char" | "line" | null; // Track visual mode type
}

const defaultVimState: VimState = {
  mode: "normal",
  relativeLineNumbers: false,
  isCommandMode: false,
  commandInput: "",
  lastCommand: "",
  lastKey: null,
  keyBuffer: [],
  visualSelection: {
    start: null,
    end: null,
  },
  visualMode: null,
};

const useVimStoreBase = create(
  immer(
    combine(defaultVimState, (set, get) => ({
      actions: {
        setMode: (mode: VimMode) => {
          set((state) => {
            state.mode = mode;
            // Clear key buffer when switching modes
            state.keyBuffer = [];
            // Clear command mode when switching modes
            if (mode !== "normal") {
              state.isCommandMode = false;
              state.commandInput = "";
            }
            // Clear visual selection when leaving visual mode
            if (mode !== "visual") {
              state.visualSelection.start = null;
              state.visualSelection.end = null;
              state.visualMode = null;
            }
          });
        },

        enterCommandMode: () => {
          set((state) => {
            state.isCommandMode = true;
            state.commandInput = "";
          });
        },

        exitCommandMode: () => {
          set((state) => {
            state.isCommandMode = false;
            state.commandInput = "";
          });
        },

        updateCommandInput: (input: string) => {
          set((state) => {
            state.commandInput = input;
          });
        },

        executeCommand: (command: string) => {
          set((state) => {
            state.lastCommand = command;
            state.isCommandMode = false;
            state.commandInput = "";
          });

          // Return the command for external handling
          return command;
        },

        setRelativeLineNumbers: (enabled: boolean, options?: { persist?: boolean }) => {
          if (get().relativeLineNumbers === enabled) {
            return;
          }

          set((state) => {
            state.relativeLineNumbers = enabled;
          });

          if (options?.persist === false) {
            return;
          }

          void useSettingsStore.getState().updateSetting("vimRelativeLineNumbers", enabled);
        },

        setVisualSelection: (
          start: { line: number; column: number } | null,
          end: { line: number; column: number } | null,
        ) => {
          set((state) => {
            state.visualSelection.start = start;
            state.visualSelection.end = end;
          });
        },

        setLastKey: (key: string | null) => {
          set((state) => {
            state.lastKey = key;
          });
        },

        clearLastKey: () => {
          set((state) => {
            state.lastKey = null;
          });
        },

        addToKeyBuffer: (key: string) => {
          set((state) => {
            state.keyBuffer.push(key);
          });
        },

        clearKeyBuffer: () => {
          set((state) => {
            state.keyBuffer = [];
          });
        },

        getKeyBuffer: (): string[] => {
          return get().keyBuffer;
        },

        setVisualMode: (mode: "char" | "line" | null) => {
          set((state) => {
            state.visualMode = mode;
          });
        },

        reset: () => {
          set(() => ({ ...defaultVimState }));
        },

        // Helper to check if vim is in a state that should capture keyboard input
        isCapturingInput: (): boolean => {
          const state = get();
          return state.mode === "insert" || state.isCommandMode;
        },

        // Helper to get current mode display string
        getModeDisplay: (): string => {
          const state = get();
          if (state.isCommandMode) return "COMMAND";

          switch (state.mode) {
            case "normal":
              return "NORMAL";
            case "insert":
              return "INSERT";
            case "visual":
              return "VISUAL";
            case "command":
              return "COMMAND";
            default:
              return "NORMAL";
          }
        },
      },
    })),
  ),
);

export const useVimStore = createSelectors(useVimStoreBase);

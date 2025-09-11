import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";

export type VimMode = "normal" | "insert" | "visual" | "command";

interface VimState {
  mode: VimMode;
  isCommandMode: boolean; // When user presses : in normal mode
  commandInput: string; // The command being typed after :
  lastCommand: string; // Store the last executed command
  lastKey: string | null; // For double key commands like dd, yy
  visualSelection: {
    start: { line: number; column: number } | null;
    end: { line: number; column: number } | null;
  };
}

const defaultVimState: VimState = {
  mode: "normal",
  isCommandMode: false,
  commandInput: "",
  lastCommand: "",
  lastKey: null,
  visualSelection: {
    start: null,
    end: null,
  },
};

const useVimStoreBase = create(
  immer(
    combine(defaultVimState, (set, get) => ({
      actions: {
        setMode: (mode: VimMode) => {
          set((state) => {
            state.mode = mode;
            // Clear command mode when switching modes
            if (mode !== "normal") {
              state.isCommandMode = false;
              state.commandInput = "";
            }
            // Clear visual selection when leaving visual mode
            if (mode !== "visual") {
              state.visualSelection.start = null;
              state.visualSelection.end = null;
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

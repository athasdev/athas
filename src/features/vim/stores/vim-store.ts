import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useSettingsStore } from "@/features/settings/store";
import { createSelectors } from "@/utils/zustand-selectors";

export type VimMode = "normal" | "insert" | "visual" | "command";

/**
 * Register content
 */
export interface RegisterContent {
  content: string;
  type: "line" | "char";
}

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
  visualMode: "char" | "line" | "block" | null; // Track visual mode type
  register: {
    text: string;
    isLineWise: boolean;
  };
  // New multi-register system
  registers: Record<string, RegisterContent>; // Named registers (a-z, 0-9, ", +, *, _, /)
  activeRegister: string | null; // Currently selected register via " prefix
  lastOperation: {
    type: "command" | "action" | null;
    keys: string[];
    count?: number;
  } | null; // Legacy - for old parser
  lastRepeatableCommand: any | null; // Store the last Command AST for repeat (.) functionality
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
  register: {
    text: "",
    isLineWise: false,
  },
  // Initialize multi-register system
  registers: {
    '"': { content: "", type: "char" }, // Unnamed register (default)
    "0": { content: "", type: "char" }, // Yank register
    "-": { content: "", type: "char" }, // Small delete register
    _: { content: "", type: "char" }, // Black hole register
    "/": { content: "", type: "char" }, // Last search pattern
    "+": { content: "", type: "char" }, // System clipboard
    "*": { content: "", type: "char" }, // Selection clipboard
  },
  activeRegister: null,
  lastOperation: null,
  lastRepeatableCommand: null,
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

        setRegister: (text: string, isLineWise: boolean) => {
          set((state) => {
            state.register.text = text;
            state.register.isLineWise = isLineWise;
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

        setVisualMode: (mode: "char" | "line" | "block" | null) => {
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

        // Last operation management for repeat functionality
        setLastOperation: (operation: VimState["lastOperation"]) => {
          set((state) => {
            state.lastOperation = operation;
          });
        },

        getLastOperation: (): VimState["lastOperation"] => {
          return get().lastOperation;
        },

        clearLastOperation: () => {
          set((state) => {
            state.lastOperation = null;
          });
        },

        // Last command management for new grammar-based repeat
        setLastRepeatableCommand: (command: any) => {
          set((state) => {
            state.lastRepeatableCommand = command;
          });
        },

        getLastRepeatableCommand: (): any => {
          return get().lastRepeatableCommand;
        },

        clearLastRepeatableCommand: () => {
          set((state) => {
            state.lastRepeatableCommand = null;
          });
        },

        // Register management
        setRegisterContent: (
          name: string,
          content: string,
          type: "line" | "char",
          options?: { source?: "yank" | "delete" },
        ) => {
          set((state) => {
            state.registers[name] = { content, type };

            // Also update unnamed register for most operations
            if (name !== '"' && name !== "_") {
              state.registers['"'] = { content, type };
            }

            // Update yank register (0) only for yank operations
            // This prevents delete operations from polluting the yank register
            if (options?.source === "yank") {
              state.registers["0"] = { content, type };
            }

            // Sync with legacy register for backward compatibility
            if (name === '"' || !name) {
              state.register.text = content;
              state.register.isLineWise = type === "line";
            }
          });
        },

        getRegisterContent: (name: string): RegisterContent => {
          const state = get();
          return state.registers[name] || { content: "", type: "char" };
        },

        setActiveRegisterName: (name: string | null) => {
          set((state) => {
            state.activeRegister = name;
          });
        },

        getActiveRegisterName: (): string => {
          const state = get();
          return state.activeRegister || '"';
        },

        clearActiveRegister: () => {
          set((state) => {
            state.activeRegister = null;
          });
        },
      },
    })),
  ),
);

export const useVimStore = createSelectors(useVimStoreBase);

import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useSettingsStore } from "@/features/settings/store";
import { createSelectors } from "@/utils/zustand-selectors";

export type VimMode = "normal" | "insert" | "visual" | "command";

interface RegisterEntry {
  content: string;
  linewise: boolean;
}

interface MarkEntry {
  line: number;
  column: number;
}

interface JumpEntry {
  line: number;
  column: number;
}

const MAX_JUMP_LIST_SIZE = 100;
const MAX_NUMBERED_REGISTERS = 9;

interface VimState {
  mode: VimMode;
  relativeLineNumbers: boolean;
  isCommandMode: boolean;
  commandInput: string;
  lastCommand: string;
  lastKey: string | null;
  keyBuffer: string[];
  visualSelection: {
    start: { line: number; column: number } | null;
    end: { line: number; column: number } | null;
  };
  visualMode: "char" | "line" | null;
  register: {
    text: string;
    isLineWise: boolean;
  };
  lastOperation: {
    type: "command" | "action" | null;
    keys: string[];
    count?: number;
  } | null;
  registers: Map<string, RegisterEntry>;
  currentRegister: string | null;
  marks: Map<string, MarkEntry>;
  jumpList: JumpEntry[];
  jumpListIndex: number;
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
  lastOperation: null,
  registers: new Map<string, RegisterEntry>(),
  currentRegister: null,
  marks: new Map<string, MarkEntry>(),
  jumpList: [],
  jumpListIndex: -1,
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

        enterVisualMode: (
          visualMode: "char" | "line",
          anchor: { line: number; column: number },
        ) => {
          set((state) => {
            state.mode = "visual";
            state.isCommandMode = false;
            state.commandInput = "";
            state.keyBuffer = [];
            state.visualMode = visualMode;
            state.visualSelection.start = anchor;
            state.visualSelection.end = anchor;
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

        // Named register system
        setCurrentRegister: (reg: string) => {
          set((state) => {
            state.currentRegister = reg;
          });
        },

        clearCurrentRegister: () => {
          set((state) => {
            state.currentRegister = null;
          });
        },

        setNamedRegister: (name: string, content: string, linewise: boolean) => {
          set((state) => {
            state.registers.set(name, { content, linewise });
          });
        },

        getNamedRegister: (name: string): RegisterEntry | undefined => {
          return get().registers.get(name);
        },

        writeToRegister: (content: string, linewise: boolean, isDelete: boolean) => {
          const state = get();
          const targetRegister = state.currentRegister;

          set((draft) => {
            // Always write to unnamed register
            draft.registers.set("", { content, linewise });

            if (targetRegister) {
              // User explicitly specified a register with "
              if (targetRegister >= "A" && targetRegister <= "Z") {
                // Uppercase register: append to the lowercase variant
                const lowerReg = targetRegister.toLowerCase();
                const existing = draft.registers.get(lowerReg);
                if (existing) {
                  draft.registers.set(lowerReg, {
                    content: existing.content + content,
                    linewise: existing.linewise || linewise,
                  });
                } else {
                  draft.registers.set(lowerReg, { content, linewise });
                }
              } else {
                draft.registers.set(targetRegister, { content, linewise });
              }
              draft.currentRegister = null;
            } else if (isDelete) {
              // Shift numbered delete registers 1-9
              for (let i = MAX_NUMBERED_REGISTERS; i >= 2; i--) {
                const prev = draft.registers.get(String(i - 1));
                if (prev) {
                  draft.registers.set(String(i), { ...prev });
                }
              }
              draft.registers.set("1", { content, linewise });
            } else {
              // Yank: write to "0" register
              draft.registers.set("0", { content, linewise });
            }
          });
        },

        readFromRegister: (): RegisterEntry | undefined => {
          const state = get();
          const targetRegister = state.currentRegister;

          if (targetRegister) {
            // Clear the current register after reading
            set((draft) => {
              draft.currentRegister = null;
            });
            const regName =
              targetRegister >= "A" && targetRegister <= "Z"
                ? targetRegister.toLowerCase()
                : targetRegister;
            return state.registers.get(regName);
          }

          // Default: read from unnamed register
          return state.registers.get("");
        },

        // Marks system
        setMark: (name: string, line: number, column: number) => {
          set((state) => {
            state.marks.set(name, { line, column });
          });
        },

        getMark: (name: string): MarkEntry | undefined => {
          return get().marks.get(name);
        },

        // Jump list system
        pushJump: (line: number, column: number) => {
          set((state) => {
            // If we're in the middle of the list, truncate forward entries
            if (state.jumpListIndex < state.jumpList.length - 1) {
              state.jumpList = state.jumpList.slice(0, state.jumpListIndex + 1);
            }

            // Don't push duplicate of the current position
            const last = state.jumpList[state.jumpList.length - 1];
            if (last && last.line === line && last.column === column) {
              return;
            }

            state.jumpList.push({ line, column });

            // Limit jump list size
            if (state.jumpList.length > MAX_JUMP_LIST_SIZE) {
              state.jumpList = state.jumpList.slice(state.jumpList.length - MAX_JUMP_LIST_SIZE);
            }

            state.jumpListIndex = state.jumpList.length - 1;
          });
        },

        jumpBack: (): JumpEntry | null => {
          const state = get();
          if (state.jumpListIndex <= 0) return null;

          const newIndex = state.jumpListIndex - 1;
          const entry = state.jumpList[newIndex];
          if (!entry) return null;

          set((draft) => {
            draft.jumpListIndex = newIndex;
          });

          return { line: entry.line, column: entry.column };
        },

        jumpForward: (): JumpEntry | null => {
          const state = get();
          if (state.jumpListIndex >= state.jumpList.length - 1) return null;

          const newIndex = state.jumpListIndex + 1;
          const entry = state.jumpList[newIndex];
          if (!entry) return null;

          set((draft) => {
            draft.jumpListIndex = newIndex;
          });

          return { line: entry.line, column: entry.column };
        },
      },
    })),
  ),
);

export const useVimStore = createSelectors(useVimStoreBase);

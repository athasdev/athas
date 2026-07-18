import { createStore } from "zustand/vanilla";
import { dedupePersistedTerminals } from "@/features/terminal/lib/terminal-session-storage";
import type {
  Terminal,
  TerminalAction,
  TerminalState,
} from "@/features/terminal/types/terminal.types";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export const generateTerminalId = (name: string): string => {
  return `terminal_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

export const terminalReducer = (state: TerminalState, action: TerminalAction): TerminalState => {
  switch (action.type) {
    case "CREATE_TERMINAL": {
      const {
        name,
        currentDirectory,
        shell,
        id,
        remoteConnectionId,
        profileId,
        initialCommand,
        customName,
      } = action.payload;
      if (id && state.terminals.some((terminal) => terminal.id === id)) {
        return {
          terminals: state.terminals.map((terminal) => ({
            ...terminal,
            isActive: terminal.id === id,
          })),
          activeTerminalId: id,
        };
      }

      // Generate a unique name if needed
      const existingNames = state.terminals.map((t) => t.name);
      let terminalName = name;
      let counter = 0;
      while (existingNames.includes(terminalName)) {
        counter++;
        terminalName = `${name} (${counter})`;
      }

      const newTerminal: Terminal = {
        id: id || generateTerminalId(terminalName),
        name: terminalName,
        currentDirectory,
        isActive: true,
        isPinned: false,
        shell,
        profileId,
        initialCommand,
        remoteConnectionId,
        customName: customName ?? false,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      return {
        terminals: state.terminals
          .map((terminal) => ({ ...terminal, isActive: false }))
          .concat(newTerminal),
        activeTerminalId: newTerminal.id,
      };
    }

    case "CLOSE_TERMINAL": {
      const { id } = action.payload;
      const terminalIndex = state.terminals.findIndex((terminal) => terminal.id === id);

      if (terminalIndex === -1) return state;

      const newTerminals = state.terminals.filter((terminal) => terminal.id !== id);

      // If we're closing the active terminal, switch to another one
      let newActiveTerminalId = state.activeTerminalId;
      if (state.activeTerminalId === id) {
        if (newTerminals.length > 0) {
          // Switch to the next terminal, or previous if we were at the end
          const nextIndex = terminalIndex < newTerminals.length ? terminalIndex : terminalIndex - 1;
          newActiveTerminalId = newTerminals[nextIndex]?.id || null;
        } else {
          newActiveTerminalId = null;
        }
      }

      // Also clean up any terminals that were split with the closed terminal
      const cleanedTerminals = newTerminals.map((terminal) => {
        if (terminal.splitWithId === id) {
          // Remove split mode if the paired terminal is being closed
          return {
            ...terminal,
            splitMode: false,
            splitWithId: undefined,
            isActive: terminal.id === newActiveTerminalId,
          };
        }
        return {
          ...terminal,
          isActive: terminal.id === newActiveTerminalId,
        };
      });

      return {
        terminals: cleanedTerminals,
        activeTerminalId: newActiveTerminalId,
      };
    }

    case "SET_ACTIVE_TERMINAL": {
      const { id } = action.payload;
      return {
        ...state,
        activeTerminalId: id,
        terminals: state.terminals.map((terminal) => ({
          ...terminal,
          isActive: terminal.id === id,
        })),
      };
    }

    case "UPDATE_TERMINAL_NAME": {
      const { id, name } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, name, customName: true } : terminal,
        ),
      };
    }

    case "UPDATE_TERMINAL_DIRECTORY": {
      const { id, currentDirectory } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map((terminal) =>
          terminal.id === id
            ? { ...terminal, currentDirectory, lastActivity: new Date() }
            : terminal,
        ),
      };
    }

    case "UPDATE_TERMINAL_ACTIVITY": {
      const { id } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, lastActivity: new Date() } : terminal,
        ),
      };
    }

    case "PIN_TERMINAL": {
      const { id, isPinned } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, isPinned } : terminal,
        ),
      };
    }

    case "REORDER_TERMINALS": {
      const { fromIndex, toIndex } = action.payload;
      const newTerminals = [...state.terminals];
      const [movedTerminal] = newTerminals.splice(fromIndex, 1);
      newTerminals.splice(toIndex, 0, movedTerminal);

      return {
        ...state,
        terminals: newTerminals,
      };
    }

    case "SET_TERMINAL_SPLIT_MODE": {
      const { id, splitMode, splitWithId } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map((terminal) =>
          terminal.id === id ? { ...terminal, splitMode, splitWithId } : terminal,
        ),
      };
    }

    case "RESET_TERMINALS": {
      return {
        terminals: [],
        activeTerminalId: null,
      };
    }

    case "RESTORE_TERMINALS": {
      const { terminals } = action.payload;
      const newTerminals: Terminal[] = dedupePersistedTerminals(terminals).map((pt) => ({
        id: pt.id,
        name: pt.name,
        currentDirectory: pt.currentDirectory,
        isActive: false,
        isPinned: pt.isPinned,
        shell: pt.shell,
        profileId: pt.profileId,
        customName: pt.customName ?? false,
        remoteConnectionId: pt.remoteConnectionId,
        createdAt: new Date(),
        lastActivity: new Date(),
      }));

      if (newTerminals.length > 0) {
        newTerminals[0].isActive = true;
      }

      return {
        terminals: newTerminals,
        activeTerminalId: newTerminals.length > 0 ? newTerminals[0].id : null,
      };
    }

    default:
      return state;
  }
};

interface TerminalTabsStore extends TerminalState {
  hasHydrated: boolean;
  dispatch: (action: TerminalAction) => void;
}

const createTerminalTabsStore = () =>
  createStore<TerminalTabsStore>()((set) => ({
    terminals: [],
    activeTerminalId: null,
    hasHydrated: false,
    dispatch: (action) =>
      set((state) => ({
        ...terminalReducer(state, action),
        hasHydrated: true,
      })),
  }));

export const useTerminalTabsStore = createWorkspaceScopedStore(
  "terminal-tabs",
  createTerminalTabsStore,
);

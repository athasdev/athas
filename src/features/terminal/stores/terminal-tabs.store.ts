import { createStore } from "zustand/vanilla";
import { dedupePersistedTerminals } from "@/features/terminal/lib/terminal-session-storage";
import type {
  Terminal,
  TerminalAction,
  TerminalState,
} from "@/features/terminal/types/terminal.types";
import {
  distributeTerminalLayout,
  findTerminalLayout,
  getLayoutTerminalIds,
  removeTerminalFromLayouts,
  resizeTerminalLayout,
  sanitizeTerminalLayouts,
  splitTerminalLayout,
} from "@/features/terminal/utils/terminal-layout";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export const generateTerminalId = (name: string): string => {
  return `terminal_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

const terminalReducer = (state: TerminalState, action: TerminalAction): TerminalState => {
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
        environment,
        customName,
      } = action.payload;
      if (id && state.terminals.some((terminal) => terminal.id === id)) {
        return {
          ...state,
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
        environment,
        remoteConnectionId,
        customName: customName ?? false,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      return {
        ...state,
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
      const layout = findTerminalLayout(state.layouts, id);
      const layouts = removeTerminalFromLayouts(state.layouts, id);

      // If we're closing the active terminal, prefer a sibling pane from the same
      // layout, otherwise the neighbouring tab.
      let newActiveTerminalId = state.activeTerminalId;
      if (state.activeTerminalId === id) {
        const siblings = layout ? getLayoutTerminalIds(layout) : [];
        const siblingIndex = siblings.indexOf(id);
        const sibling = siblings[siblingIndex - 1] ?? siblings[siblingIndex + 1];
        if (sibling && newTerminals.some((terminal) => terminal.id === sibling)) {
          newActiveTerminalId = sibling;
        } else if (newTerminals.length > 0) {
          const nextIndex = terminalIndex < newTerminals.length ? terminalIndex : terminalIndex - 1;
          newActiveTerminalId = newTerminals[nextIndex]?.id || null;
        } else {
          newActiveTerminalId = null;
        }
      }

      return {
        ...state,
        terminals: newTerminals.map((terminal) => ({
          ...terminal,
          isActive: terminal.id === newActiveTerminalId,
        })),
        activeTerminalId: newActiveTerminalId,
        layouts,
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

    case "SPLIT_TERMINAL": {
      const { terminalId, newTerminalId, direction, placement } = action.payload;
      const exists = (id: string) => state.terminals.some((terminal) => terminal.id === id);
      if (!exists(terminalId) || !exists(newTerminalId)) return state;

      return {
        ...state,
        layouts: splitTerminalLayout(
          state.layouts,
          terminalId,
          newTerminalId,
          direction,
          placement,
        ),
        activeTerminalId: newTerminalId,
        terminals: state.terminals.map((terminal) => ({
          ...terminal,
          isActive: terminal.id === newTerminalId,
        })),
      };
    }

    case "UNSPLIT_TERMINAL": {
      const layouts = removeTerminalFromLayouts(state.layouts, action.payload.terminalId);
      return layouts === state.layouts ? state : { ...state, layouts };
    }

    case "RESIZE_TERMINAL_SPLIT": {
      const { splitId, index, sizes } = action.payload;
      const layouts = resizeTerminalLayout(state.layouts, splitId, index, sizes);
      return layouts === state.layouts ? state : { ...state, layouts };
    }

    case "DISTRIBUTE_TERMINAL_SPLIT": {
      const layouts = distributeTerminalLayout(state.layouts, action.payload.splitId);
      return layouts === state.layouts ? state : { ...state, layouts };
    }

    case "RESET_TERMINALS": {
      return {
        terminals: [],
        activeTerminalId: null,
        layouts: [],
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
        layouts: sanitizeTerminalLayouts(
          action.payload.layouts,
          newTerminals.map((terminal) => terminal.id),
        ),
      };
    }

    default:
      return state;
  }
};

interface TerminalTabsStore extends TerminalState {
  hasHydrated: boolean;
  actions: {
    dispatch: (action: TerminalAction) => void;
  };
}

const createTerminalTabsStore = () =>
  createStore<TerminalTabsStore>()((set) => ({
    terminals: [],
    activeTerminalId: null,
    layouts: [],
    hasHydrated: false,
    actions: {
      dispatch: (action) =>
        set((state) => ({
          ...terminalReducer(state, action),
          hasHydrated: true,
        })),
    },
  }));

export const useTerminalTabsStore = createWorkspaceScopedStore(
  "terminal-tabs",
  createTerminalTabsStore,
);

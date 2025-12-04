import { useCallback, useEffect, useReducer } from "react";
import type {
  PersistedTerminal,
  Terminal,
  TerminalAction,
  TerminalState,
} from "@/features/terminal/types/terminal";

const PERSISTENCE_KEY = "terminal-sessions";
const PERSISTENCE_ENABLED_KEY = "terminal-persistence-enabled";

const isPersistenceEnabled = (): boolean => {
  try {
    const enabled = localStorage.getItem(PERSISTENCE_ENABLED_KEY);
    return enabled === null || enabled === "true"; // Default to true
  } catch {
    return true;
  }
};

const saveTerminalsToStorage = (terminals: Terminal[]) => {
  if (!isPersistenceEnabled()) return;

  try {
    const persistedTerminals: PersistedTerminal[] = terminals.map((t) => ({
      id: t.id,
      name: t.name,
      currentDirectory: t.currentDirectory,
      isPinned: t.isPinned || false,
      shell: t.shell,
      title: t.title,
    }));
    localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(persistedTerminals));
  } catch (error) {
    console.error("Failed to save terminals to storage:", error);
  }
};

const loadTerminalsFromStorage = (): PersistedTerminal[] => {
  if (!isPersistenceEnabled()) return [];

  try {
    const stored = localStorage.getItem(PERSISTENCE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error("Failed to load terminals from storage:", error);
    return [];
  }
};

export const setTerminalPersistence = (enabled: boolean) => {
  try {
    localStorage.setItem(PERSISTENCE_ENABLED_KEY, String(enabled));
    if (!enabled) {
      localStorage.removeItem(PERSISTENCE_KEY);
    }
  } catch (error) {
    console.error("Failed to update persistence setting:", error);
  }
};

const generateTerminalId = (name: string): string => {
  return `terminal_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

const terminalReducer = (state: TerminalState, action: TerminalAction): TerminalState => {
  switch (action.type) {
    case "CREATE_TERMINAL": {
      const { name, currentDirectory, shell, id } = action.payload;

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
          terminal.id === id ? { ...terminal, name } : terminal,
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
      const newTerminals: Terminal[] = terminals.map((pt) => ({
        id: pt.id,
        name: pt.name,
        currentDirectory: pt.currentDirectory,
        isActive: false,
        isPinned: pt.isPinned,
        shell: pt.shell,
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

export const useTerminalTabs = () => {
  const [state, dispatch] = useReducer(terminalReducer, {
    terminals: [],
    activeTerminalId: null,
  });

  // Save terminals to storage whenever state changes
  useEffect(() => {
    saveTerminalsToStorage(state.terminals);
  }, [state.terminals]);

  // Listen for global workspace reset event
  useEffect(() => {
    const handleResetWorkspace = () => {
      dispatch({ type: "RESET_TERMINALS", payload: {} });
    };

    window.addEventListener("reset-workspace", handleResetWorkspace);

    const handleRestoreTerminals = (event: Event) => {
      const customEvent = event as CustomEvent<{ terminals: PersistedTerminal[] }>;
      dispatch({ type: "RESTORE_TERMINALS", payload: { terminals: customEvent.detail.terminals } });
    };

    window.addEventListener("restore-terminals", handleRestoreTerminals);

    return () => {
      window.removeEventListener("reset-workspace", handleResetWorkspace);
      window.removeEventListener("restore-terminals", handleRestoreTerminals);
    };
  }, []);

  const createTerminal = useCallback(
    (name: string, currentDirectory: string, shell?: string): string => {
      // Generate the terminal ID here so we can return it
      const terminalId = generateTerminalId(name);
      dispatch({
        type: "CREATE_TERMINAL",
        payload: { name, currentDirectory, shell, id: terminalId },
      });
      return terminalId;
    },
    [],
  );

  const closeTerminal = useCallback((id: string) => {
    dispatch({ type: "CLOSE_TERMINAL", payload: { id } });
  }, []);

  const setActiveTerminal = useCallback((id: string) => {
    dispatch({ type: "SET_ACTIVE_TERMINAL", payload: { id } });
  }, []);

  const updateTerminalName = useCallback((id: string, name: string) => {
    dispatch({ type: "UPDATE_TERMINAL_NAME", payload: { id, name } });
  }, []);

  const updateTerminalDirectory = useCallback((id: string, currentDirectory: string) => {
    dispatch({ type: "UPDATE_TERMINAL_DIRECTORY", payload: { id, currentDirectory } });
  }, []);

  const updateTerminalActivity = useCallback((id: string) => {
    dispatch({ type: "UPDATE_TERMINAL_ACTIVITY", payload: { id } });
  }, []);

  const pinTerminal = useCallback((id: string, isPinned: boolean) => {
    dispatch({ type: "PIN_TERMINAL", payload: { id, isPinned } });
  }, []);

  const reorderTerminals = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: "REORDER_TERMINALS", payload: { fromIndex, toIndex } });
  }, []);

  const getActiveTerminal = useCallback((): Terminal | null => {
    return state.terminals.find((terminal) => terminal.id === state.activeTerminalId) || null;
  }, [state.terminals, state.activeTerminalId]);

  const switchToNextTerminal = useCallback(() => {
    if (state.terminals.length <= 1) return;

    const currentIndex = state.terminals.findIndex(
      (terminal) => terminal.id === state.activeTerminalId,
    );
    const nextIndex = (currentIndex + 1) % state.terminals.length;
    const nextTerminal = state.terminals[nextIndex];

    if (nextTerminal) {
      setActiveTerminal(nextTerminal.id);
    }
  }, [state.terminals, state.activeTerminalId, setActiveTerminal]);

  const switchToPrevTerminal = useCallback(() => {
    if (state.terminals.length <= 1) return;

    const currentIndex = state.terminals.findIndex(
      (terminal) => terminal.id === state.activeTerminalId,
    );
    const prevIndex = currentIndex === 0 ? state.terminals.length - 1 : currentIndex - 1;
    const prevTerminal = state.terminals[prevIndex];

    if (prevTerminal) {
      setActiveTerminal(prevTerminal.id);
    }
  }, [state.terminals, state.activeTerminalId, setActiveTerminal]);

  const setTerminalSplitMode = useCallback(
    (id: string, splitMode: boolean, splitWithId?: string) => {
      dispatch({ type: "SET_TERMINAL_SPLIT_MODE", payload: { id, splitMode, splitWithId } });
    },
    [],
  );

  const getPersistedTerminals = useCallback((): PersistedTerminal[] => {
    return loadTerminalsFromStorage();
  }, []);

  const restoreTerminalsFromPersisted = useCallback((persistedTerminals: PersistedTerminal[]) => {
    persistedTerminals.forEach((pt) => {
      dispatch({
        type: "CREATE_TERMINAL",
        payload: {
          name: pt.name,
          currentDirectory: pt.currentDirectory,
          shell: pt.shell,
          id: pt.id,
        },
      });
      if (pt.isPinned) {
        dispatch({ type: "PIN_TERMINAL", payload: { id: pt.id, isPinned: true } });
      }
    });
  }, []);

  return {
    terminals: state.terminals,
    activeTerminalId: state.activeTerminalId,
    createTerminal,
    closeTerminal,
    setActiveTerminal,
    updateTerminalName,
    updateTerminalDirectory,
    updateTerminalActivity,
    pinTerminal,
    reorderTerminals,
    getActiveTerminal,
    switchToNextTerminal,
    switchToPrevTerminal,
    setTerminalSplitMode,
    getPersistedTerminals,
    restoreTerminalsFromPersisted,
  };
};

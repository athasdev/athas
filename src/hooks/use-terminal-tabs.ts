import { useCallback, useReducer } from "react";
import type { Terminal, TerminalAction, TerminalState } from "../types/terminal";

const generateTerminalId = (name: string): string => {
  return `terminal_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

const terminalReducer = (state: TerminalState, action: TerminalAction): TerminalState => {
  switch (action.type) {
    case "CREATE_TERMINAL": {
      const { name, currentDirectory, shell } = action.payload;

      // Generate a unique name if needed
      const existingNames = state.terminals.map(t => t.name);
      let terminalName = name;
      let counter = 0;
      while (existingNames.includes(terminalName)) {
        counter++;
        terminalName = `${name} (${counter})`;
      }

      const newTerminal: Terminal = {
        id: generateTerminalId(terminalName),
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
          .map(terminal => ({ ...terminal, isActive: false }))
          .concat(newTerminal),
        activeTerminalId: newTerminal.id,
      };
    }

    case "CLOSE_TERMINAL": {
      const { id } = action.payload;
      const terminalIndex = state.terminals.findIndex(terminal => terminal.id === id);

      if (terminalIndex === -1) return state;

      const newTerminals = state.terminals.filter(terminal => terminal.id !== id);

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

      return {
        terminals: newTerminals.map(terminal => ({
          ...terminal,
          isActive: terminal.id === newActiveTerminalId,
        })),
        activeTerminalId: newActiveTerminalId,
      };
    }

    case "SET_ACTIVE_TERMINAL": {
      const { id } = action.payload;
      return {
        ...state,
        activeTerminalId: id,
        terminals: state.terminals.map(terminal => ({
          ...terminal,
          isActive: terminal.id === id,
        })),
      };
    }

    case "UPDATE_TERMINAL_NAME": {
      const { id, name } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map(terminal =>
          terminal.id === id ? { ...terminal, name } : terminal,
        ),
      };
    }

    case "UPDATE_TERMINAL_DIRECTORY": {
      const { id, currentDirectory } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map(terminal =>
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
        terminals: state.terminals.map(terminal =>
          terminal.id === id ? { ...terminal, lastActivity: new Date() } : terminal,
        ),
      };
    }

    case "PIN_TERMINAL": {
      const { id, isPinned } = action.payload;
      return {
        ...state,
        terminals: state.terminals.map(terminal =>
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

    default:
      return state;
  }
};

export const useTerminalTabs = () => {
  const [state, dispatch] = useReducer(terminalReducer, {
    terminals: [],
    activeTerminalId: null,
  });

  const createTerminal = useCallback((name: string, currentDirectory: string, shell?: string) => {
    dispatch({ type: "CREATE_TERMINAL", payload: { name, currentDirectory, shell } });
  }, []);

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
    return state.terminals.find(terminal => terminal.id === state.activeTerminalId) || null;
  }, [state.terminals, state.activeTerminalId]);

  const switchToNextTerminal = useCallback(() => {
    if (state.terminals.length <= 1) return;

    const currentIndex = state.terminals.findIndex(
      terminal => terminal.id === state.activeTerminalId,
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
      terminal => terminal.id === state.activeTerminalId,
    );
    const prevIndex = currentIndex === 0 ? state.terminals.length - 1 : currentIndex - 1;
    const prevTerminal = state.terminals[prevIndex];

    if (prevTerminal) {
      setActiveTerminal(prevTerminal.id);
    }
  }, [state.terminals, state.activeTerminalId, setActiveTerminal]);

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
  };
};

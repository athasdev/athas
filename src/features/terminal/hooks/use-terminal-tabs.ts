import { useCallback, useEffect } from "react";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import {
  generateTerminalId,
  useTerminalTabsStore,
} from "@/features/terminal/stores/terminal-tabs.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";

export const useTerminalTabs = () => {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const state = useTerminalTabsStore();
  const dispatch = state.dispatch;

  // Save terminals to storage whenever state changes
  useEffect(() => {
    if (rootFolderPath && state.hasHydrated) {
      workspaceSessionRepository.saveTerminals(rootFolderPath, state.terminals);
    }
  }, [rootFolderPath, state.hasHydrated, state.terminals]);

  // Listen for global workspace reset event
  useEffect(() => {
    const handleResetWorkspace = () => {
      dispatch({ type: "RESET_TERMINALS", payload: {} });
    };

    window.addEventListener("reset-workspace", handleResetWorkspace);

    return () => {
      window.removeEventListener("reset-workspace", handleResetWorkspace);
    };
  }, [dispatch]);

  const createTerminal = useCallback(
    ({
      name,
      currentDirectory,
      shell,
      remoteConnectionId,
      profileId,
      initialCommand,
    }: {
      name: string;
      currentDirectory: string;
      shell?: string;
      remoteConnectionId?: string;
      profileId?: string;
      initialCommand?: string;
    }): string => {
      // Generate the terminal ID here so we can return it
      const terminalId = generateTerminalId(name);
      const resolvedRemoteConnectionId =
        remoteConnectionId ?? parseRemotePath(currentDirectory)?.connectionId;
      dispatch({
        type: "CREATE_TERMINAL",
        payload: {
          name,
          currentDirectory,
          shell,
          id: terminalId,
          remoteConnectionId: resolvedRemoteConnectionId,
          profileId,
          initialCommand,
        },
      });
      return terminalId;
    },
    [dispatch],
  );

  const closeTerminal = useCallback(
    (id: string) => {
      dispatch({ type: "CLOSE_TERMINAL", payload: { id } });
    },
    [dispatch],
  );

  const setActiveTerminal = useCallback(
    (id: string) => {
      dispatch({ type: "SET_ACTIVE_TERMINAL", payload: { id } });
    },
    [dispatch],
  );

  const updateTerminalName = useCallback(
    (id: string, name: string) => {
      dispatch({ type: "UPDATE_TERMINAL_NAME", payload: { id, name } });
    },
    [dispatch],
  );

  const updateTerminalDirectory = useCallback(
    (id: string, currentDirectory: string) => {
      dispatch({ type: "UPDATE_TERMINAL_DIRECTORY", payload: { id, currentDirectory } });
    },
    [dispatch],
  );

  const updateTerminalActivity = useCallback(
    (id: string) => {
      dispatch({ type: "UPDATE_TERMINAL_ACTIVITY", payload: { id } });
    },
    [dispatch],
  );

  const pinTerminal = useCallback(
    (id: string, isPinned: boolean) => {
      dispatch({ type: "PIN_TERMINAL", payload: { id, isPinned } });
    },
    [dispatch],
  );

  const reorderTerminals = useCallback(
    (fromIndex: number, toIndex: number) => {
      dispatch({ type: "REORDER_TERMINALS", payload: { fromIndex, toIndex } });
    },
    [dispatch],
  );

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
    [dispatch],
  );

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
  };
};

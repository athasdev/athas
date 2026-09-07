import { useCallback, useEffect } from "react";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { SplitPlacement } from "@/features/panes/types/pane.types";
import type { Terminal, TerminalSplitDirection } from "@/features/terminal/types/terminal.types";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import {
  generateTerminalId,
  useTerminalTabsStore,
} from "@/features/terminal/stores/terminal-tabs.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";

export const useTerminalTabs = () => {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const terminals = useTerminalTabsStore((state) => state.terminals);
  const activeTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const layouts = useTerminalTabsStore((state) => state.layouts);
  const hasHydrated = useTerminalTabsStore((state) => state.hasHydrated);
  const dispatch = useTerminalTabsStore((state) => state.actions.dispatch);

  // Save terminals to storage whenever state changes
  useEffect(() => {
    if (rootFolderPath && hasHydrated) {
      workspaceSessionRepository.saveTerminals(rootFolderPath, terminals);
    }
  }, [rootFolderPath, hasHydrated, terminals]);

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
      environment,
    }: {
      name: string;
      currentDirectory: string;
      shell?: string;
      remoteConnectionId?: string;
      profileId?: string;
      initialCommand?: string;
      environment?: Record<string, string>;
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
          environment,
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
    return terminals.find((terminal) => terminal.id === activeTerminalId) || null;
  }, [terminals, activeTerminalId]);

  const switchToNextTerminal = useCallback(() => {
    if (terminals.length <= 1) return;

    const currentIndex = terminals.findIndex((terminal) => terminal.id === activeTerminalId);
    const nextIndex = (currentIndex + 1) % terminals.length;
    const nextTerminal = terminals[nextIndex];

    if (nextTerminal) {
      setActiveTerminal(nextTerminal.id);
    }
  }, [terminals, activeTerminalId, setActiveTerminal]);

  const switchToPrevTerminal = useCallback(() => {
    if (terminals.length <= 1) return;

    const currentIndex = terminals.findIndex((terminal) => terminal.id === activeTerminalId);
    const prevIndex = currentIndex === 0 ? terminals.length - 1 : currentIndex - 1;
    const prevTerminal = terminals[prevIndex];

    if (prevTerminal) {
      setActiveTerminal(prevTerminal.id);
    }
  }, [terminals, activeTerminalId, setActiveTerminal]);

  const splitTerminal = useCallback(
    (
      terminalId: string,
      newTerminalId: string,
      direction: TerminalSplitDirection,
      placement?: SplitPlacement,
    ) => {
      dispatch({
        type: "SPLIT_TERMINAL",
        payload: { terminalId, newTerminalId, direction, placement },
      });
    },
    [dispatch],
  );

  const unsplitTerminal = useCallback(
    (terminalId: string) => {
      dispatch({ type: "UNSPLIT_TERMINAL", payload: { terminalId } });
    },
    [dispatch],
  );

  const resizeTerminalSplit = useCallback(
    (splitId: string, index: number, sizes: [number, number]) => {
      dispatch({ type: "RESIZE_TERMINAL_SPLIT", payload: { splitId, index, sizes } });
    },
    [dispatch],
  );

  const distributeTerminalSplit = useCallback(
    (splitId: string) => {
      dispatch({ type: "DISTRIBUTE_TERMINAL_SPLIT", payload: { splitId } });
    },
    [dispatch],
  );

  return {
    terminals,
    activeTerminalId,
    layouts,
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
    splitTerminal,
    unsplitTerminal,
    resizeTerminalSplit,
    distributeTerminalSplit,
  };
};

import { invoke } from "@tauri-apps/api/core";
import type React from "react";
import type {
  TerminalCommandNavigationDirection,
  TerminalSessionHandle,
} from "../types/terminal.types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  CLOSE_TERMINAL_EVENT,
  RENAME_TERMINAL_EVENT,
} from "@/features/terminal/constants/terminal-events";
import { useTerminalTabs } from "@/features/terminal/hooks/use-terminal-tabs";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { notifyTerminalCommandFinished } from "@/features/terminal/services/terminal-command-notifications";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import type { PaneNode, SplitPlacement } from "@/features/panes/types/pane.types";
import type {
  Terminal,
  TerminalCommandSummary,
  TerminalSplitDirection,
} from "@/features/terminal/types/terminal.types";
import { getTerminalDisplayName } from "@/features/terminal/utils/terminal-display-name";
import {
  findTerminalLayout,
  getAdjacentLayoutTerminalId,
  getLayoutMemberIds,
} from "@/features/terminal/utils/terminal-layout";
import {
  resolveTerminalLaunch,
  SYSTEM_DEFAULT_PROFILE_ID,
} from "@/features/terminal/utils/terminal-profiles";
import { shouldCloseTerminalPane } from "@/features/terminal/utils/terminal-pane-lifecycle";
import { useUIState } from "@/features/window/stores/ui-state.store";
import TerminalSession from "./terminal-session";
import { TerminalSplitView } from "./terminal-split-view";
import TerminalTabBar from "./terminal-tab-bar";

interface TerminalContainerProps {
  currentDirectory?: string;
  className?: string;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

interface CloseTerminalOptions {
  preserveSession?: boolean;
}

function createTimeoutRegistry() {
  const timeoutIds = new Set<ReturnType<typeof setTimeout>>();

  return {
    schedule(callback: () => void, delay: number) {
      const timeoutId = setTimeout(() => {
        timeoutIds.delete(timeoutId);
        callback();
      }, delay);
      timeoutIds.add(timeoutId);
    },
    clear() {
      for (const timeoutId of timeoutIds) clearTimeout(timeoutId);
      timeoutIds.clear();
    },
  };
}

const TerminalContainer = ({
  currentDirectory = "/",
  className = "",
  onFullScreen,
  isFullScreen = false,
}: TerminalContainerProps) => {
  const getDisplayNameFromDirectory = useCallback((directory: string) => {
    const normalized = directory.replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || "terminal";
  }, []);

  const {
    terminals,
    activeTerminalId,
    createTerminal,
    closeTerminal: originalCloseTerminal,
    setActiveTerminal,
    updateTerminalName,
    updateTerminalDirectory,
    updateTerminalActivity,
    pinTerminal,
    reorderTerminals,
    switchToNextTerminal,
    switchToPrevTerminal,
    splitTerminal,
    unsplitTerminal,
    resizeTerminalSplit,
    distributeTerminalSplit,
    layouts,
  } = useTerminalTabs();
  const terminalDefaultProfileId = useSettingsStore(
    (state) => state.settings.terminalDefaultProfileId,
  );
  const terminalDefaultShellId = useSettingsStore((state) => state.settings.terminalDefaultShellId);
  const terminalCommandNotifications = useSettingsStore(
    (state) => state.settings.terminalCommandNotifications,
  );
  const customProfiles = useTerminalProfilesStore.use.profiles();
  const availableShells = useTerminalShellsStore.use.shells();

  // Wrapper to add logging and ensure terminal closes properly
  const closeTerminal = useCallback(
    (terminalId: string, options: CloseTerminalOptions = {}) => {
      const terminalStore = useTerminalStore.getState();
      const session = terminalStore.actions.getSession(terminalId);
      originalCloseTerminal(terminalId);

      if (options.preserveSession) return;

      if (session?.connectionId) {
        void closeTerminalConnection(session).catch((error) => {
          console.error("Failed to close terminal session:", error);
        });
      }

      terminalStore.actions.removeSession(terminalId);
    },
    [originalCloseTerminal],
  );

  const wasVisibleRef = useRef(false);
  const previousTerminalCountRef = useRef(terminals.length);
  const workspaceDirectoryRef = useRef(currentDirectory);
  const terminalSessionRefs = useRef<Map<string, TerminalSessionHandle>>(new Map());
  const tabFocusTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    if (workspaceDirectoryRef.current === currentDirectory) {
      return;
    }

    workspaceDirectoryRef.current = currentDirectory;
    previousTerminalCountRef.current = terminals.length;
    wasVisibleRef.current = false;
  }, [currentDirectory, terminals.length]);
  const registerTerminalFocus = useUIState((state) => state.registerTerminalFocus);
  const clearTerminalFocus = useUIState((state) => state.clearTerminalFocus);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const isTerminalPaneVisible = isBottomPaneVisible && bottomPaneActiveTab === "terminal";

  useEffect(() => {
    void useTerminalShellsStore.getState().actions.loadShells();
  }, []);

  const focusNewTerminal = useCallback((terminalId: string) => {
    const existingTimeout = tabFocusTimeoutRef.current.get(terminalId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    const timeoutId = setTimeout(() => {
      const terminalRef = terminalSessionRefs.current.get(terminalId);
      if (terminalRef) {
        terminalRef.focus();
      }
      tabFocusTimeoutRef.current.delete(terminalId);
    }, 150);
    tabFocusTimeoutRef.current.set(terminalId, timeoutId);
  }, []);

  const handleNewTerminal = useCallback(
    (profileId?: string) => {
      const resolvedLaunch = resolveTerminalLaunch({
        currentDirectory,
        customProfiles,
        explicitProfileId: profileId,
        settings: {
          terminalDefaultProfileId,
          terminalDefaultShellId,
        },
        shells: availableShells,
      });
      const dirName = getDisplayNameFromDirectory(resolvedLaunch.workingDirectory);
      const newTerminalId = createTerminal({
        name:
          resolvedLaunch.profileId &&
          resolvedLaunch.profileId !== SYSTEM_DEFAULT_PROFILE_ID &&
          resolvedLaunch.name.trim()
            ? resolvedLaunch.name
            : dirName,
        currentDirectory: resolvedLaunch.workingDirectory,
        shell: resolvedLaunch.shell,
        profileId: resolvedLaunch.profileId,
        initialCommand: resolvedLaunch.initialCommand,
      });
      focusNewTerminal(newTerminalId);
    },
    [
      availableShells,
      createTerminal,
      currentDirectory,
      customProfiles,
      focusNewTerminal,
      getDisplayNameFromDirectory,
      terminalDefaultProfileId,
      terminalDefaultShellId,
    ],
  );

  const handleTabCreate = useCallback(
    (directory: string, shell?: string, profileId?: string) => {
      const dirName = getDisplayNameFromDirectory(directory);
      const newTerminalId = createTerminal({
        name: dirName,
        currentDirectory: directory,
        shell,
        profileId,
      });
      focusNewTerminal(newTerminalId);
    },
    [createTerminal, focusNewTerminal, getDisplayNameFromDirectory],
  );

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      tabFocusTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
      tabFocusTimeoutRef.current.clear();
    };
  }, []);

  // Auto-close the terminal pane when its final terminal is closed
  useEffect(() => {
    const shouldClose = shouldCloseTerminalPane({
      previousTerminalCount: previousTerminalCountRef.current,
      terminalCount: terminals.length,
      isTerminalPaneVisible,
    });
    previousTerminalCountRef.current = terminals.length;

    if (shouldClose) {
      setIsBottomPaneVisible(false);
    }
  }, [isTerminalPaneVisible, terminals.length, setIsBottomPaneVisible]);

  const focusStoreActiveTerminal = useCallback(() => {
    const nextActiveId = useTerminalTabsStore.getState().activeTerminalId;
    if (nextActiveId) focusNewTerminal(nextActiveId);
  }, [focusNewTerminal]);

  const handleTabClick = useCallback(
    (terminalId: string) => {
      setActiveTerminal(terminalId);
      // Focus is handled by XtermTerminal's isActive effect with verified retry.
      // No additional focus attempt needed here to avoid race conditions.
    },
    [setActiveTerminal],
  );

  const handleTabClose = useCallback(
    (terminalId: string, event?: React.MouseEvent) => {
      event?.stopPropagation();

      const wasActive = terminalId === activeTerminalId;
      closeTerminal(terminalId);

      // The reducer picks the next active terminal (a split sibling when there
      // is one), so focus whatever it chose instead of guessing by index.
      if (wasActive) focusStoreActiveTerminal();
    },
    [activeTerminalId, closeTerminal, focusStoreActiveTerminal],
  );

  const handleTabPin = useCallback(
    (terminalId: string) => {
      const terminal = terminals.find((t) => t.id === terminalId);
      if (terminal) {
        pinTerminal(terminalId, !terminal.isPinned);
      }
    },
    [terminals, pinTerminal],
  );

  const handleTabRename = useCallback(
    (terminalId: string, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;

      updateTerminalName(terminalId, trimmedName);
      useTerminalStore.getState().actions.updateSession(terminalId, {
        name: trimmedName,
        customName: true,
      });

      const { buffers, actions } = useBufferStore.getState();
      buffers
        .filter((buffer) => buffer.type === "terminal" && buffer.sessionId === terminalId)
        .forEach((buffer) => actions.updateBuffer({ ...buffer, name: trimmedName }));
    },
    [updateTerminalName],
  );

  const handleCloseOtherTabs = useCallback(
    (terminalId: string) => {
      terminals.forEach((terminal) => {
        if (terminal.id !== terminalId && !terminal.isPinned) {
          closeTerminal(terminal.id);
        }
      });
    },
    [terminals, closeTerminal],
  );

  const handleCloseAllTabs = useCallback(() => {
    terminals.forEach((terminal) => {
      if (!terminal.isPinned) {
        closeTerminal(terminal.id);
      }
    });
  }, [terminals, closeTerminal]);

  const handleCloseTabsToRight = useCallback(
    (terminalId: string) => {
      const targetIndex = terminals.findIndex((t) => t.id === terminalId);
      if (targetIndex === -1) return;

      terminals.slice(targetIndex + 1).forEach((terminal) => {
        if (!terminal.isPinned) {
          closeTerminal(terminal.id);
        }
      });
    },
    [terminals, closeTerminal],
  );

  const handleSplitView = useCallback(
    (direction: TerminalSplitDirection, terminalId: string | null = activeTerminalId) => {
      if (!terminalId) return;

      const sourceTerminal = terminals.find((t) => t.id === terminalId);
      if (!sourceTerminal) return;

      const companionId = createTerminal({
        name: sourceTerminal.name,
        currentDirectory: sourceTerminal.currentDirectory,
        shell: sourceTerminal.shell,
        profileId: sourceTerminal.profileId,
        remoteConnectionId: sourceTerminal.remoteConnectionId,
      });
      splitTerminal(terminalId, companionId, direction);
      focusNewTerminal(companionId);
    },
    [activeTerminalId, terminals, createTerminal, splitTerminal, focusNewTerminal],
  );

  const handleSplitWithTerminal = useCallback(
    (
      targetTerminalId: string,
      droppedTerminalId: string,
      direction: TerminalSplitDirection,
      placement: SplitPlacement,
    ) => {
      splitTerminal(targetTerminalId, droppedTerminalId, direction, placement);
      focusNewTerminal(droppedTerminalId);
    },
    [splitTerminal, focusNewTerminal],
  );

  const handleUnsplit = useCallback(
    (terminalId: string) => {
      unsplitTerminal(terminalId);
      setActiveTerminal(terminalId);
      focusNewTerminal(terminalId);
    },
    [unsplitTerminal, setActiveTerminal, focusNewTerminal],
  );

  const handleSearchTerminal = useCallback(() => {
    if (!activeTerminalId) return;
    terminalSessionRefs.current.get(activeTerminalId)?.showSearch();
  }, [activeTerminalId]);

  const handleDirectoryChange = useCallback(
    (terminalId: string, directory: string) => {
      updateTerminalDirectory(terminalId, directory);
    },
    [updateTerminalDirectory],
  );

  const handleActivity = useCallback(
    (terminalId: string) => {
      updateTerminalActivity(terminalId);
    },
    [updateTerminalActivity],
  );

  // Focus the active terminal
  const focusActiveTerminal = useCallback(() => {
    if (activeTerminalId) {
      const terminalRef = terminalSessionRefs.current.get(activeTerminalId);
      if (terminalRef) {
        terminalRef.focus();
      }
    }
  }, [activeTerminalId]);

  // Register terminal session ref
  const registerTerminalRef = useCallback(
    (terminalId: string, ref: TerminalSessionHandle | null) => {
      if (ref) {
        terminalSessionRefs.current.set(terminalId, ref);
      } else {
        terminalSessionRefs.current.delete(terminalId);
      }
    },
    [],
  );

  // Register focus callback with UI state
  useEffect(() => {
    registerTerminalFocus(focusActiveTerminal);
    return () => {
      clearTerminalFocus();
    };
  }, [registerTerminalFocus, clearTerminalFocus, focusActiveTerminal]);

  // Listen for close-active-terminal event from native menu / keybinding
  useEffect(() => {
    const handleCloseActiveTerminal = () => {
      if (!activeTerminalId) return;

      closeTerminal(activeTerminalId);
      focusStoreActiveTerminal();
    };

    window.addEventListener("close-active-terminal", handleCloseActiveTerminal);
    return () => window.removeEventListener("close-active-terminal", handleCloseActiveTerminal);
  }, [activeTerminalId, closeTerminal, focusStoreActiveTerminal]);

  useEffect(() => {
    const handleCloseTerminal = (event: Event) => {
      const terminalId = (event as CustomEvent<{ terminalId?: string }>).detail?.terminalId;
      if (terminalId) handleTabClose(terminalId);
    };

    window.addEventListener(CLOSE_TERMINAL_EVENT, handleCloseTerminal);
    return () => window.removeEventListener(CLOSE_TERMINAL_EVENT, handleCloseTerminal);
  }, [handleTabClose]);

  useEffect(() => {
    const handleRenameTerminal = (event: Event) => {
      const { terminalId, name } = (event as CustomEvent<{ terminalId?: string; name?: string }>)
        .detail;
      if (terminalId && name) handleTabRename(terminalId, name);
    };

    window.addEventListener(RENAME_TERMINAL_EVENT, handleRenameTerminal);
    return () => window.removeEventListener(RENAME_TERMINAL_EVENT, handleRenameTerminal);
  }, [handleTabRename]);

  // Store pending commands for terminals that are initializing
  const pendingCommandsRef = useRef<Map<string, string>>(new Map());

  // Listen for create-terminal-with-command event (used by agent install buttons)
  useEffect(() => {
    const focusTimers = createTimeoutRegistry();
    const handleCreateTerminalWithCommand = (event: Event) => {
      const customEvent = event as CustomEvent<{
        command: string;
        name?: string;
        workingDirectory?: string;
        environment?: Record<string, string>;
      }>;
      const { command, name, workingDirectory, environment } = customEvent.detail;
      const terminalDirectory = workingDirectory || currentDirectory;

      // Show bottom pane and switch to terminal tab
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);

      // Create a new terminal
      const commandLabel = command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop();
      const terminalName = name || commandLabel || getDisplayNameFromDirectory(terminalDirectory);
      const newTerminalId = createTerminal({
        name: terminalName,
        currentDirectory: terminalDirectory,
        environment,
      });

      if (newTerminalId) {
        // Store the pending command
        pendingCommandsRef.current.set(newTerminalId, `${command}\n`);

        // Focus the terminal after creation
        focusTimers.schedule(() => {
          const terminalRef = terminalSessionRefs.current.get(newTerminalId);
          if (terminalRef) {
            terminalRef.focus();
          }
        }, 150);
      }
    };

    window.addEventListener("create-terminal-with-command", handleCreateTerminalWithCommand);
    return () => {
      focusTimers.clear();
      window.removeEventListener("create-terminal-with-command", handleCreateTerminalWithCommand);
    };
  }, [
    createTerminal,
    currentDirectory,
    getDisplayNameFromDirectory,
    setBottomPaneActiveTab,
    setIsBottomPaneVisible,
  ]);

  // Listen for terminal-ready events to execute pending commands
  useEffect(() => {
    const commandTimers = createTimeoutRegistry();
    const handleTerminalReady = (event: Event) => {
      const customEvent = event as CustomEvent<{
        terminalId: string;
        connectionId: string;
        remoteConnectionId?: string;
      }>;
      const { terminalId, connectionId, remoteConnectionId } = customEvent.detail;

      const pendingCommand = pendingCommandsRef.current.get(terminalId);
      if (pendingCommand && connectionId) {
        // Small delay to ensure shell prompt is ready
        commandTimers.schedule(() => {
          invoke(remoteConnectionId ? "remote_terminal_write" : "terminal_write", {
            id: connectionId,
            input: { kind: "text", data: pendingCommand },
          }).catch(() => {});
          pendingCommandsRef.current.delete(terminalId);
        }, 300);
      }
    };

    window.addEventListener("terminal-ready", handleTerminalReady);
    return () => {
      commandTimers.clear();
      window.removeEventListener("terminal-ready", handleTerminalReady);
    };
  }, []);

  useEffect(() => {
    const handleTerminalOpenSearch = () => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.showSearch();
    };

    window.addEventListener("terminal-open-search", handleTerminalOpenSearch);
    return () => window.removeEventListener("terminal-open-search", handleTerminalOpenSearch);
  }, [activeTerminalId]);

  useEffect(() => {
    const handleNavigateCommand = (event: Event) => {
      if (!activeTerminalId) return;
      const direction = (event as CustomEvent<TerminalCommandNavigationDirection>).detail;
      terminalSessionRefs.current.get(activeTerminalId)?.navigateCommand(direction);
    };

    window.addEventListener("terminal-navigate-command", handleNavigateCommand);
    return () => window.removeEventListener("terminal-navigate-command", handleNavigateCommand);
  }, [activeTerminalId]);

  useEffect(() => {
    if (!activeTerminalId || !isTerminalPaneVisible) return;
    const session = useTerminalStore.getState().sessions.get(activeTerminalId);
    if (session?.lastCommand) {
      useTerminalStore.getState().actions.updateSession(activeTerminalId, {
        lastCommand: undefined,
      });
    }
  }, [activeTerminalId, isTerminalPaneVisible]);

  useEffect(() => {
    const activateTerminal = (terminalId: string) => {
      if (!terminals.some((terminal) => terminal.id === terminalId)) return;
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);
      setActiveTerminal(terminalId);
      requestAnimationFrame(() => terminalSessionRefs.current.get(terminalId)?.focus());
    };

    const handleCommandFinished = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId: string; command: TerminalCommandSummary }>)
        .detail;
      const terminal = terminals.find((candidate) => candidate.id === detail.terminalId);
      if (!terminal) return;

      const isShownInPane =
        activeTerminalId !== null &&
        getLayoutMemberIds(layouts, activeTerminalId).includes(terminal.id);
      const isTerminalVisible = isTerminalPaneVisible && isShownInPane;

      if (!isTerminalVisible) {
        useTerminalStore.getState().actions.updateSession(terminal.id, {
          lastCommand: detail.command,
        });
      }

      if (!terminalCommandNotifications) return;
      void notifyTerminalCommandFinished(
        {
          terminalId: terminal.id,
          terminalName: getTerminalDisplayName(
            terminal,
            useTerminalStore.getState().sessions.get(terminal.id),
          ),
          command: detail.command,
          isTerminalVisible,
        },
        activateTerminal,
      );
    };

    const handleActivateTerminal = (event: Event) => {
      const terminalId = (event as CustomEvent<{ terminalId?: string }>).detail?.terminalId;
      if (terminalId) activateTerminal(terminalId);
    };

    window.addEventListener("terminal-command-finished", handleCommandFinished);
    window.addEventListener("terminal-activate", handleActivateTerminal);
    return () => {
      window.removeEventListener("terminal-command-finished", handleCommandFinished);
      window.removeEventListener("terminal-activate", handleActivateTerminal);
    };
  }, [
    activeTerminalId,
    isTerminalPaneVisible,
    layouts,
    setActiveTerminal,
    setBottomPaneActiveTab,
    setIsBottomPaneVisible,
    terminalCommandNotifications,
    terminals,
  ]);

  useEffect(() => {
    const handleFocusPane = (event: Event) => {
      if (!activeTerminalId) return;
      const direction = (event as CustomEvent<"next" | "previous">).detail;
      const target = getAdjacentLayoutTerminalId(
        layouts,
        activeTerminalId,
        direction === "previous" ? -1 : 1,
      );
      if (!target) return;
      setActiveTerminal(target);
      focusNewTerminal(target);
    };

    const handleUnsplitEvent = () => {
      if (activeTerminalId) handleUnsplit(activeTerminalId);
    };

    window.addEventListener("terminal-focus-pane", handleFocusPane);
    window.addEventListener("terminal-unsplit", handleUnsplitEvent);
    return () => {
      window.removeEventListener("terminal-focus-pane", handleFocusPane);
      window.removeEventListener("terminal-unsplit", handleUnsplitEvent);
    };
  }, [activeTerminalId, focusNewTerminal, handleUnsplit, layouts, setActiveTerminal]);

  useEffect(() => {
    const handleClear = () => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.clear();
    };
    const handleSelectAll = () => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.selectAll();
    };
    const handleCopyLastCommandOutput = () => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.copyLastCommandOutput();
    };

    window.addEventListener("terminal-clear", handleClear);
    window.addEventListener("terminal-select-all", handleSelectAll);
    window.addEventListener("terminal-copy-last-command-output", handleCopyLastCommandOutput);
    return () => {
      window.removeEventListener("terminal-clear", handleClear);
      window.removeEventListener("terminal-select-all", handleSelectAll);
      window.removeEventListener("terminal-copy-last-command-output", handleCopyLastCommandOutput);
    };
  }, [activeTerminalId]);

  // Listen for terminal tab switch events from the keymaps system
  useEffect(() => {
    const handleTerminalSwitchTab = (e: Event) => {
      const direction = (e as CustomEvent).detail;
      if (direction === "next") {
        switchToNextTerminal();
      } else {
        switchToPrevTerminal();
      }
    };

    window.addEventListener("terminal-switch-tab", handleTerminalSwitchTab);
    return () => window.removeEventListener("terminal-switch-tab", handleTerminalSwitchTab);
  }, [switchToNextTerminal, switchToPrevTerminal]);

  useEffect(() => {
    const handleNewTerminalEvent = () => {
      handleNewTerminal();
    };

    const handleDetachTerminalToBuffer = (event: Event) => {
      const terminalId = (event as CustomEvent<{ terminalId?: string }>).detail?.terminalId;
      if (!terminalId) return;
      requestAnimationFrame(() => {
        closeTerminal(terminalId, { preserveSession: true });
      });
    };

    const handleEnsureTerminalSession = () => {
      if (terminals.length === 0) {
        handleNewTerminal();
        return;
      }

      focusActiveTerminal();
    };

    const handleSplitTerminalEvent = (event: Event) => {
      const direction = (event as CustomEvent<TerminalSplitDirection>).detail ?? "right";
      handleSplitView(direction);
    };

    const handleActivateTerminalTab = (event: Event) => {
      const tabIndex = (event as CustomEvent<number>).detail;
      if (typeof tabIndex !== "number" || tabIndex < 0 || tabIndex >= terminals.length) return;
      setActiveTerminal(terminals[tabIndex].id);
    };

    window.addEventListener("terminal-new", handleNewTerminalEvent);
    window.addEventListener("terminal-detach-to-buffer", handleDetachTerminalToBuffer);
    window.addEventListener("terminal-ensure-session", handleEnsureTerminalSession);
    window.addEventListener("terminal-split", handleSplitTerminalEvent);
    window.addEventListener("terminal-activate-tab", handleActivateTerminalTab);

    return () => {
      window.removeEventListener("terminal-new", handleNewTerminalEvent);
      window.removeEventListener("terminal-detach-to-buffer", handleDetachTerminalToBuffer);
      window.removeEventListener("terminal-ensure-session", handleEnsureTerminalSession);
      window.removeEventListener("terminal-split", handleSplitTerminalEvent);
      window.removeEventListener("terminal-activate-tab", handleActivateTerminalTab);
    };
  }, [
    terminals,
    focusActiveTerminal,
    handleNewTerminal,
    setActiveTerminal,
    handleSplitView,
    closeTerminal,
  ]);

  // Create terminal when pane becomes visible with no terminals
  useEffect(() => {
    const isTerminalVisible = isBottomPaneVisible && bottomPaneActiveTab === "terminal";
    const justBecameVisible = isTerminalVisible && !wasVisibleRef.current;

    if (justBecameVisible && terminals.length === 0) {
      handleNewTerminal();
    }

    wasVisibleRef.current = isTerminalVisible;
  }, [isBottomPaneVisible, bottomPaneActiveTab, terminals.length, handleNewTerminal]);

  const terminalTabBarProps = {
    terminals,
    activeTerminalId,
    onTabClick: handleTabClick,
    onTabClose: handleTabClose,
    onTabReorder: reorderTerminals,
    onTabPin: handleTabPin,
    onTabRename: handleTabRename,
    onNewTerminal: handleNewTerminal,
    onTabCreate: handleTabCreate,
    onCloseOtherTabs: handleCloseOtherTabs,
    onCloseAllTabs: handleCloseAllTabs,
    onCloseTabsToRight: handleCloseTabsToRight,
    onSearchTerminal: handleSearchTerminal,
    onSplitTerminal: handleSplitView,
    onSplitWithTerminal: handleSplitWithTerminal,
    onUnsplitTerminal: handleUnsplit,
    layouts,
    onNextTerminal: switchToNextTerminal,
    onPrevTerminal: switchToPrevTerminal,
    onFullScreen,
    isFullScreen,
  };
  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId);
  const activeLayout = useMemo<PaneNode | null>(() => {
    if (!activeTerminalId) return null;
    return (
      findTerminalLayout(layouts, activeTerminalId) ?? {
        id: `terminal-standalone-${activeTerminalId}`,
        type: "group",
        bufferIds: [activeTerminalId],
        activeBufferId: activeTerminalId,
      }
    );
  }, [activeTerminalId, layouts]);
  const renderTerminalSession = (terminal: Terminal) => (
    <TerminalSession
      terminal={terminal}
      isActive={terminal.id === activeTerminalId}
      isVisible={isTerminalPaneVisible}
      onDirectoryChange={handleDirectoryChange}
      onActivity={handleActivity}
      onRegisterRef={registerTerminalRef}
      onTerminalExit={closeTerminal}
    />
  );

  const terminalSessions = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {activeTerminal && activeLayout ? (
        <TerminalSplitView
          layout={activeLayout}
          activeTerminalId={activeTerminalId}
          renderTerminal={(terminalId) => {
            const terminal = terminals.find((candidate) => candidate.id === terminalId);
            return terminal ? renderTerminalSession(terminal) : null;
          }}
          onActivate={setActiveTerminal}
          onResize={resizeTerminalSplit}
          onDistribute={distributeTerminalSplit}
        />
      ) : null}
    </div>
  );

  return (
    <div
      className={`terminal-container flex h-full flex-col overflow-hidden ${className}`}
      data-terminal-container="active"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <TerminalTabBar {...terminalTabBarProps} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {terminalSessions}
        </div>
      </div>
    </div>
  );
};

export default TerminalContainer;

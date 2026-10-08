import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { writeLocalTerminalInput, writeRemoteTerminalInput } from "../services/terminal-pty-api";
import type React from "react";
import type {
  TerminalCommandNavigationDirection,
  TerminalSessionHandle,
} from "../types/terminal.types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
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
} from "@/features/terminal/services/terminal-profiles";
import { shouldCloseTerminalPane } from "@/features/terminal/utils/terminal-pane-lifecycle";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { onAppEvent } from "@/utils/app-events";
import TerminalSession from "./terminal-session";
import { TerminalSplitView } from "./terminal-split-view";
import TerminalTabBar from "./terminal-tab-bar";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";

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
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspaceId = useWorkspaceStoreScopeId() ?? activeWorkspaceId;
  const terminalStoreApi = useTerminalStore.getStore(workspaceId);
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
      const terminalStore = terminalStoreApi.getState();
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
    [originalCloseTerminal, terminalStoreApi],
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
  const isTerminalPaneVisible = useUIState(selectIsTerminalPaneVisible);

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

    return onAppEvent("close-active-terminal", handleCloseActiveTerminal);
  }, [activeTerminalId, closeTerminal, focusStoreActiveTerminal]);

  // Store pending commands for terminals that are initializing
  const pendingCommandsRef = useRef<Map<string, string>>(new Map());

  // Listen for create-terminal-with-command event (used by agent install buttons)
  useEffect(() => {
    const focusTimers = createTimeoutRegistry();
    const unsubscribe = onAppEvent("create-terminal-with-command", (request) => {
      const { command, name, workingDirectory, environment } = request;
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
    });

    return () => {
      focusTimers.clear();
      unsubscribe();
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
    const unsubscribe = onAppEvent("terminal-ready", (session) => {
      const { terminalId, connectionId, remoteConnectionId } = session;

      const pendingCommand = pendingCommandsRef.current.get(terminalId);
      if (pendingCommand && connectionId) {
        // Small delay to ensure shell prompt is ready
        commandTimers.schedule(() => {
          const input = { kind: "text", data: pendingCommand } as const;
          const request = remoteConnectionId
            ? writeRemoteTerminalInput(connectionId, input)
            : writeLocalTerminalInput(connectionId, input);
          request.catch(() => {});
          pendingCommandsRef.current.delete(terminalId);
        }, 300);
      }
    });

    return () => {
      commandTimers.clear();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleTerminalOpenSearch = () => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.showSearch();
    };

    return onAppEvent("terminal-open-search", handleTerminalOpenSearch);
  }, [activeTerminalId]);

  useEffect(() => {
    const handleNavigateCommand = (direction: TerminalCommandNavigationDirection) => {
      if (!activeTerminalId) return;
      terminalSessionRefs.current.get(activeTerminalId)?.navigateCommand(direction);
    };

    return onAppEvent("terminal-navigate-command", handleNavigateCommand);
  }, [activeTerminalId]);

  useEffect(() => {
    if (!activeTerminalId || !isTerminalPaneVisible) return;
    const session = terminalStoreApi.getState().sessions.get(activeTerminalId);
    if (session?.lastCommand) {
      terminalStoreApi.getState().actions.updateSession(activeTerminalId, {
        lastCommand: undefined,
      });
    }
  }, [activeTerminalId, isTerminalPaneVisible, terminalStoreApi]);

  useEffect(() => {
    const activateTerminal = (terminalId: string) => {
      if (!terminals.some((terminal) => terminal.id === terminalId)) return;
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);
      setActiveTerminal(terminalId);
      requestAnimationFrame(() => terminalSessionRefs.current.get(terminalId)?.focus());
    };

    const handleCommandFinished = (detail: {
      terminalId: string;
      command: TerminalCommandSummary;
    }) => {
      const terminal = terminals.find((candidate) => candidate.id === detail.terminalId);
      if (!terminal) return;

      const isShownInPane =
        activeTerminalId !== null &&
        getLayoutMemberIds(layouts, activeTerminalId).includes(terminal.id);
      const isTerminalVisible = isTerminalPaneVisible && isShownInPane;

      if (!isTerminalVisible) {
        terminalStoreApi.getState().actions.updateSession(terminal.id, {
          lastCommand: detail.command,
        });
      }

      if (!terminalCommandNotifications) return;
      void notifyTerminalCommandFinished(
        {
          terminalId: terminal.id,
          terminalName: getTerminalDisplayName(
            terminal,
            terminalStoreApi.getState().sessions.get(terminal.id),
          ),
          command: detail.command,
          isTerminalVisible,
        },
        activateTerminal,
      );
    };

    return onAppEvent("terminal-command-finished", handleCommandFinished);
  }, [
    activeTerminalId,
    isTerminalPaneVisible,
    layouts,
    setActiveTerminal,
    setBottomPaneActiveTab,
    setIsBottomPaneVisible,
    terminalCommandNotifications,
    terminalStoreApi,
    terminals,
  ]);

  useEffect(() => {
    const handleFocusPane = (direction: "next" | "previous") => {
      if (!activeTerminalId) return;
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

    const unsubscribeFocusPane = onAppEvent("terminal-focus-pane", handleFocusPane);
    const unsubscribeUnsplit = onAppEvent("terminal-unsplit", handleUnsplitEvent);
    return () => {
      unsubscribeFocusPane();
      unsubscribeUnsplit();
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

    const unsubscribers = [
      onAppEvent("terminal-clear", handleClear),
      onAppEvent("terminal-select-all", handleSelectAll),
      onAppEvent("terminal-copy-last-command-output", handleCopyLastCommandOutput),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [activeTerminalId]);

  // Listen for terminal tab switch events from the keymaps system
  useEffect(() => {
    const handleTerminalSwitchTab = (direction: "next" | "prev") => {
      if (direction === "next") {
        switchToNextTerminal();
      } else {
        switchToPrevTerminal();
      }
    };

    return onAppEvent("terminal-switch-tab", handleTerminalSwitchTab);
  }, [switchToNextTerminal, switchToPrevTerminal]);

  useEffect(() => {
    const handleNewTerminalEvent = () => {
      handleNewTerminal();
    };

    const handleDetachTerminalToBuffer = ({ terminalId }: { terminalId: string }) => {
      if (!terminalId) return;
      // The pane list owns the name until here; from now on the editor tab reads it from the
      // session, so a name the user gave the terminal goes with it.
      const terminal = terminals.find((candidate) => candidate.id === terminalId);
      if (terminal?.customName) {
        terminalStoreApi
          .getState()
          .actions.updateSession(terminalId, { name: terminal.name, customName: true });
      }
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

    const handleSplitTerminalEvent = (direction: TerminalSplitDirection = "right") => {
      handleSplitView(direction);
    };

    const handleActivateTerminalTab = (tabIndex: number) => {
      if (typeof tabIndex !== "number" || tabIndex < 0 || tabIndex >= terminals.length) return;
      setActiveTerminal(terminals[tabIndex].id);
    };

    const unsubscribers = [
      onAppEvent("terminal-new", handleNewTerminalEvent),
      onAppEvent("terminal-detach-to-buffer", handleDetachTerminalToBuffer),
      onAppEvent("terminal-ensure-session", handleEnsureTerminalSession),
      onAppEvent("terminal-split", handleSplitTerminalEvent),
      onAppEvent("terminal-activate-tab", handleActivateTerminalTab),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [
    terminals,
    focusActiveTerminal,
    handleNewTerminal,
    setActiveTerminal,
    handleSplitView,
    closeTerminal,
    terminalStoreApi,
  ]);

  // Create terminal when pane becomes visible with no terminals
  useEffect(() => {
    const justBecameVisible = isTerminalPaneVisible && !wasVisibleRef.current;

    if (justBecameVisible && terminals.length === 0) {
      handleNewTerminal();
    }

    wasVisibleRef.current = isTerminalPaneVisible;
  }, [isTerminalPaneVisible, terminals.length, handleNewTerminal]);

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

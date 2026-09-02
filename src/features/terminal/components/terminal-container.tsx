import { invoke } from "@tauri-apps/api/core";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  CLOSE_TERMINAL_EVENT,
  RENAME_TERMINAL_EVENT,
} from "@/features/terminal/constants/terminal-events";
import { useTerminalTabs } from "@/features/terminal/hooks/use-terminal-tabs";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import type { TerminalSplitDirection } from "@/features/terminal/types/terminal.types";
import {
  resolveTerminalLaunch,
  SYSTEM_DEFAULT_PROFILE_ID,
} from "@/features/terminal/utils/terminal-profiles";
import { shouldCloseTerminalPane } from "@/features/terminal/utils/terminal-pane-lifecycle";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { cn } from "@/utils/cn";
import TerminalSession from "./terminal-session";
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
    setTerminalSplitMode,
  } = useTerminalTabs();
  const terminalDefaultProfileId = useSettingsStore(
    (state) => state.settings.terminalDefaultProfileId,
  );
  const terminalDefaultShellId = useSettingsStore((state) => state.settings.terminalDefaultShellId);
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
  const terminalSessionRefs = useRef<Map<string, { focus: () => void; showSearch: () => void }>>(
    new Map(),
  );
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

      // Find which terminal will become active after closing
      const currentIndex = terminals.findIndex((t) => t.id === terminalId);
      const remaining = terminals.filter((t) => t.id !== terminalId);

      closeTerminal(terminalId);

      // Focus next terminal if we closed the active one
      if (terminalId === activeTerminalId && remaining.length > 0) {
        const nextIndex = currentIndex < remaining.length ? currentIndex : currentIndex - 1;
        const nextTerminal = remaining[nextIndex];
        if (nextTerminal) {
          focusNewTerminal(nextTerminal.id);
        }
      }
    },
    [terminals, activeTerminalId, closeTerminal, focusNewTerminal],
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
    (direction: TerminalSplitDirection) => {
      if (!activeTerminalId) return;

      const activeTerminal = terminals.find((t) => t.id === activeTerminalId);
      if (!activeTerminal) return;

      if (activeTerminal.splitMode) {
        if (activeTerminal.splitWithId && activeTerminal.splitDirection !== direction) {
          setTerminalSplitMode(activeTerminalId, true, activeTerminal.splitWithId, direction);
          return;
        }

        setTerminalSplitMode(activeTerminalId, false);
        if (activeTerminal.splitWithId) {
          closeTerminal(activeTerminal.splitWithId);
        }
      } else {
        const companionName = `${activeTerminal.name} (Split)`;
        const companionId = createTerminal({
          name: companionName,
          currentDirectory: activeTerminal.currentDirectory,
          shell: activeTerminal.shell,
          profileId: activeTerminal.profileId,
        });
        setTerminalSplitMode(activeTerminalId, true, companionId, direction);
        setActiveTerminal(activeTerminalId);
      }
    },
    [
      activeTerminalId,
      terminals,
      setTerminalSplitMode,
      createTerminal,
      closeTerminal,
      setActiveTerminal,
    ],
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
    (terminalId: string, ref: { focus: () => void; showSearch: () => void } | null) => {
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

      // Find which terminal will become active after closing
      const currentIndex = terminals.findIndex((t) => t.id === activeTerminalId);
      const remaining = terminals.filter((t) => t.id !== activeTerminalId);

      closeTerminal(activeTerminalId);

      if (remaining.length > 0) {
        // Focus the next terminal (same logic as reducer)
        const nextIndex = currentIndex < remaining.length ? currentIndex : currentIndex - 1;
        const nextTerminal = remaining[nextIndex];
        if (nextTerminal) {
          focusNewTerminal(nextTerminal.id);
        }
      }
    };

    window.addEventListener("close-active-terminal", handleCloseActiveTerminal);
    return () => window.removeEventListener("close-active-terminal", handleCloseActiveTerminal);
  }, [activeTerminalId, terminals, closeTerminal, focusNewTerminal]);

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
    onNextTerminal: switchToNextTerminal,
    onPrevTerminal: switchToPrevTerminal,
    onFullScreen,
    isFullScreen,
  };
  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId);
  const companionTerminal = activeTerminal?.splitWithId
    ? terminals.find((terminal) => terminal.id === activeTerminal.splitWithId)
    : undefined;

  const terminalSessions = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {activeTerminal && (
        <div
          className={cn(
            "flex h-full min-h-0",
            activeTerminal.splitDirection === "down" ? "flex-col" : "flex-row",
          )}
        >
          <div
            className={cn(
              "min-h-0 min-w-0",
              activeTerminal.splitMode && companionTerminal
                ? activeTerminal.splitDirection === "down"
                  ? "h-1/2 w-full border-border border-b"
                  : "h-full w-1/2 border-border border-r"
                : "size-full",
            )}
          >
            <TerminalSession
              terminal={activeTerminal}
              isActive
              isVisible={isTerminalPaneVisible}
              onDirectoryChange={handleDirectoryChange}
              onActivity={handleActivity}
              onRegisterRef={registerTerminalRef}
              onTerminalExit={closeTerminal}
            />
          </div>
          {activeTerminal.splitMode && companionTerminal && (
            <div
              className={cn(
                "min-h-0 min-w-0",
                activeTerminal.splitDirection === "down" ? "h-1/2 w-full" : "h-full w-1/2",
              )}
            >
              <TerminalSession
                terminal={companionTerminal}
                isActive={false}
                isVisible={isTerminalPaneVisible}
                onDirectoryChange={handleDirectoryChange}
                onActivity={handleActivity}
                onRegisterRef={registerTerminalRef}
                onTerminalExit={closeTerminal}
              />
            </div>
          )}
        </div>
      )}
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

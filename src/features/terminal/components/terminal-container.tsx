import { invoke } from "@tauri-apps/api/core";
import { Maximize2, Minimize2, Plus, Search, SplitSquareHorizontal } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useTerminalTabs } from "@/features/terminal/hooks/use-terminal-tabs";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles-store";
import { useTerminalStore } from "@/features/terminal/stores/terminal-store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells-store";
import {
  resolveTerminalLaunch,
  SYSTEM_DEFAULT_PROFILE_ID,
} from "@/features/terminal/utils/terminal-profiles";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import TerminalSession from "./terminal-session";
import TerminalTabBar from "./terminal-tab-bar";

interface TerminalContainerProps {
  currentDirectory?: string;
  className?: string;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
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
    getPersistedTerminals,
    restoreTerminalsFromPersisted,
  } = useTerminalTabs();
  const terminalDefaultProfileId = useSettingsStore(
    (state) => state.settings.terminalDefaultProfileId,
  );
  const terminalDefaultShellId = useSettingsStore((state) => state.settings.terminalDefaultShellId);
  const tabLayout = useTerminalStore((state) => state.tabLayout);
  const customProfiles = useTerminalProfilesStore.use.profiles();
  const availableShells = useTerminalShellsStore.use.shells();

  // Wrapper to add logging and ensure terminal closes properly
  const closeTerminal = useCallback(
    (terminalId: string) => {
      console.log("closeTerminal called for terminal:", terminalId);
      originalCloseTerminal(terminalId);
    },
    [originalCloseTerminal],
  );

  const zoomLevel = useZoomStore.use.terminalZoomLevel();

  const hasInitializedRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const terminalSessionRefs = useRef<Map<string, { focus: () => void; showSearch: () => void }>>(
    new Map(),
  );
  const tabFocusTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const {
    registerTerminalFocus,
    clearTerminalFocus,
    setIsBottomPaneVisible,
    isBottomPaneVisible,
    bottomPaneActiveTab,
  } = useUIState();
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

  // Restore persisted terminals on mount. Fresh terminal creation is deferred until pane is visible.
  useEffect(() => {
    if (!hasInitializedRef.current && terminals.length === 0) {
      const persistedTerminals = getPersistedTerminals();
      if (persistedTerminals.length > 0) {
        hasInitializedRef.current = true;
        restoreTerminalsFromPersisted(persistedTerminals);
      }
    }
  }, [terminals.length, getPersistedTerminals, restoreTerminalsFromPersisted]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      tabFocusTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
      tabFocusTimeoutRef.current.clear();
    };
  }, []);

  // Auto-close bottom pane when all terminals are closed
  useEffect(() => {
    if (terminals.length === 0 && hasInitializedRef.current) {
      setIsBottomPaneVisible(false);
    }
  }, [terminals.length, setIsBottomPaneVisible]);

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
      closeTerminal(terminalId);
    },
    [closeTerminal],
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

  const handleSplitView = useCallback(() => {
    if (!activeTerminalId) return;

    const activeTerminal = terminals.find((t) => t.id === activeTerminalId);
    if (!activeTerminal) return;

    if (activeTerminal.splitMode) {
      // Toggle off split view for this terminal
      setTerminalSplitMode(activeTerminalId, false);
      // Close the companion terminal if it exists
      if (activeTerminal.splitWithId) {
        closeTerminal(activeTerminal.splitWithId);
      }
    } else {
      // Create an actual companion terminal with independent session
      const companionName = `${activeTerminal.name} (Split)`;
      const companionId = createTerminal({
        name: companionName,
        currentDirectory: activeTerminal.currentDirectory,
        shell: activeTerminal.shell,
        profileId: activeTerminal.profileId,
      });
      setTerminalSplitMode(activeTerminalId, true, companionId);
    }
  }, [activeTerminalId, terminals, setTerminalSplitMode, createTerminal, closeTerminal]);

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

  // Listen for close-active-terminal event from native menu
  useEffect(() => {
    const handleCloseActiveTerminal = () => {
      if (activeTerminalId) {
        closeTerminal(activeTerminalId);
      }
    };

    window.addEventListener("close-active-terminal", handleCloseActiveTerminal);
    return () => window.removeEventListener("close-active-terminal", handleCloseActiveTerminal);
  }, [activeTerminalId, closeTerminal]);

  // Store pending commands for terminals that are initializing
  const pendingCommandsRef = useRef<Map<string, string>>(new Map());

  // Listen for create-terminal-with-command event (used by agent install buttons)
  useEffect(() => {
    const handleCreateTerminalWithCommand = (event: Event) => {
      const customEvent = event as CustomEvent<{
        command: string;
        name?: string;
      }>;
      const { command, name } = customEvent.detail;

      // Show bottom pane and switch to terminal tab
      setIsBottomPaneVisible(true);

      // Create a new terminal
      const commandLabel = command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop();
      const terminalName = name || commandLabel || getDisplayNameFromDirectory(currentDirectory);
      const newTerminalId = createTerminal({
        name: terminalName,
        currentDirectory,
      });

      if (newTerminalId) {
        // Store the pending command
        pendingCommandsRef.current.set(newTerminalId, `${command}\n`);

        // Focus the terminal after creation
        setTimeout(() => {
          const terminalRef = terminalSessionRefs.current.get(newTerminalId);
          if (terminalRef) {
            terminalRef.focus();
          }
        }, 150);
      }
    };

    window.addEventListener("create-terminal-with-command", handleCreateTerminalWithCommand);
    return () =>
      window.removeEventListener("create-terminal-with-command", handleCreateTerminalWithCommand);
  }, [createTerminal, currentDirectory, getDisplayNameFromDirectory, setIsBottomPaneVisible]);

  // Listen for terminal-ready events to execute pending commands
  useEffect(() => {
    const handleTerminalReady = (event: Event) => {
      const customEvent = event as CustomEvent<{
        terminalId: string;
        connectionId: string;
      }>;
      const { terminalId, connectionId } = customEvent.detail;

      const pendingCommand = pendingCommandsRef.current.get(terminalId);
      if (pendingCommand && connectionId) {
        // Small delay to ensure shell prompt is ready
        setTimeout(() => {
          invoke("terminal_write", {
            id: connectionId,
            data: pendingCommand,
          }).catch(() => {});
          pendingCommandsRef.current.delete(terminalId);
        }, 300);
      }
    };

    window.addEventListener("terminal-ready", handleTerminalReady);
    return () => window.removeEventListener("terminal-ready", handleTerminalReady);
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

    const handleEnsureTerminalSession = () => {
      if (terminals.length === 0) {
        hasInitializedRef.current = true;
        handleNewTerminal();
        return;
      }

      focusActiveTerminal();
    };

    const handleSplitTerminalEvent = () => {
      handleSplitView();
    };

    const handleActivateTerminalTab = (event: Event) => {
      const tabIndex = (event as CustomEvent<number>).detail;
      if (typeof tabIndex !== "number" || tabIndex < 0 || tabIndex >= terminals.length) return;
      setActiveTerminal(terminals[tabIndex].id);
    };

    window.addEventListener("terminal-new", handleNewTerminalEvent);
    window.addEventListener("terminal-ensure-session", handleEnsureTerminalSession);
    window.addEventListener("terminal-split", handleSplitTerminalEvent);
    window.addEventListener("terminal-activate-tab", handleActivateTerminalTab);

    return () => {
      window.removeEventListener("terminal-new", handleNewTerminalEvent);
      window.removeEventListener("terminal-ensure-session", handleEnsureTerminalSession);
      window.removeEventListener("terminal-split", handleSplitTerminalEvent);
      window.removeEventListener("terminal-activate-tab", handleActivateTerminalTab);
    };
  }, [terminals, focusActiveTerminal, handleNewTerminal, setActiveTerminal, handleSplitView]);

  // Auto-create first terminal when the pane becomes visible
  useEffect(() => {
    if (terminals.length === 0 && !hasInitializedRef.current) {
      const persistedTerminals = getPersistedTerminals();
      if (persistedTerminals.length > 0) {
        hasInitializedRef.current = true;
        restoreTerminalsFromPersisted(persistedTerminals);
      }
    }
  }, [
    terminals.length,
    currentDirectory,
    createTerminal,
    getDisplayNameFromDirectory,
    getPersistedTerminals,
    restoreTerminalsFromPersisted,
  ]);

  // Create terminal when pane becomes visible with no terminals
  useEffect(() => {
    const isTerminalVisible = isBottomPaneVisible && bottomPaneActiveTab === "terminal";
    const justBecameVisible = isTerminalVisible && !wasVisibleRef.current;

    if (justBecameVisible && terminals.length === 0) {
      hasInitializedRef.current = true;
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
    onNewTerminalWithProfile: handleNewTerminal,
    onTabCreate: handleTabCreate,
    onCloseOtherTabs: handleCloseOtherTabs,
    onCloseAllTabs: handleCloseAllTabs,
    onCloseTabsToRight: handleCloseTabsToRight,
    onSplitView: handleSplitView,
    onSearchTerminal: handleSearchTerminal,
    onNextTerminal: switchToNextTerminal,
    onPrevTerminal: switchToPrevTerminal,
    onFullScreen,
    isFullScreen,
    isSplitView: terminals.find((t) => t.id === activeTerminalId)?.splitMode || false,
  };

  const terminalSessions = (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-primary-bg"
      style={{
        transform: `scale(${zoomLevel})`,
        transformOrigin: "top left",
        width: `${100 / zoomLevel}%`,
      }}
    >
      {(() => {
        return (
          <div className="flex h-full min-h-0 flex-col">
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className="h-full min-h-0"
                style={{
                  display: terminal.id === activeTerminalId ? "flex" : "none",
                }}
              >
                <div
                  className={cn(
                    "h-full min-h-0 w-full",
                    terminal.splitMode &&
                      terminal.splitWithId &&
                      "w-1/2 border-border border-r",
                  )}
                >
                  <TerminalSession
                    key={terminal.id}
                    terminal={terminal}
                    isActive={terminal.id === activeTerminalId}
                    isVisible={isTerminalPaneVisible && terminal.id === activeTerminalId}
                    onDirectoryChange={handleDirectoryChange}
                    onActivity={handleActivity}
                    onRegisterRef={registerTerminalRef}
                    onTerminalExit={closeTerminal}
                  />
                </div>
                {terminal.splitMode &&
                  terminal.splitWithId &&
                  (() => {
                    const companionTerminal = terminals.find((t) => t.id === terminal.splitWithId);
                    if (!companionTerminal) return null;
                    return (
                      <div className="h-full min-h-0 w-1/2">
                        <TerminalSession
                          key={companionTerminal.id}
                          terminal={companionTerminal}
                          isActive={false}
                          isVisible={isTerminalPaneVisible}
                          onDirectoryChange={handleDirectoryChange}
                          onActivity={handleActivity}
                          onRegisterRef={registerTerminalRef}
                          onTerminalExit={closeTerminal}
                        />
                      </div>
                    );
                  })()}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );

  const isVertical = tabLayout === "vertical";
  const isSplitActive = terminals.find((t) => t.id === activeTerminalId)?.splitMode || false;

  return (
    <div
      className={`terminal-container flex h-full flex-col overflow-hidden ${className}`}
      data-terminal-container="active"
    >
      {/* Vertical-only actions header */}
      {isVertical && (
        <div className="flex min-h-8 shrink-0 items-center justify-end gap-1 bg-primary-bg px-1.5 py-1">
          <Tooltip content="Find in Terminal (Cmd/Ctrl+F)" side="bottom">
            <button
              type="button"
              onClick={handleSearchTerminal}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover"
              aria-label="Find in Terminal"
            >
              <Search size={12} />
            </button>
          </Tooltip>
          <Tooltip content="New Terminal (Cmd+T)" side="bottom">
            <button
              type="button"
              onClick={() => handleNewTerminal()}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover"
              aria-label="New Terminal"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
          <Tooltip
            content={isSplitActive ? "Exit Split View" : "Split Terminal View (Cmd+D)"}
            side="bottom"
          >
            <button
              type="button"
              onClick={handleSplitView}
              className={cn(
                "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border p-1",
                isSplitActive
                  ? "border-border/80 bg-primary-bg text-text"
                  : "border-transparent text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
              )}
              aria-label="Split Terminal"
            >
              <SplitSquareHorizontal size={12} />
            </button>
          </Tooltip>
          {onFullScreen && (
            <Tooltip
              content={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
              side="bottom"
            >
              <button
                type="button"
                onClick={onFullScreen}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover"
                aria-label="Full Screen Terminal"
              >
                {isFullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </Tooltip>
          )}
        </div>
      )}

      <div className={cn("min-h-0 flex-1", isVertical ? "flex flex-row" : "flex flex-col")}>
        <TerminalTabBar {...terminalTabBarProps} orientation={tabLayout} />

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            isVertical && "rounded-tl-lg border-border/60 border-t border-l",
          )}
        >
          {terminalSessions}
        </div>
      </div>
    </div>
  );
};

export default TerminalContainer;

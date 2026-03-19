import { invoke } from "@tauri-apps/api/core";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { useTerminalTabs } from "@/features/terminal/hooks/use-terminal-tabs";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
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

  const handleNewTerminal = useCallback(() => {
    const dirName = currentDirectory.split("/").pop() || "terminal";
    const newTerminalId = createTerminal(dirName, currentDirectory);
    // Focus the new terminal after creation
    if (newTerminalId) {
      // Clear any existing timeout for this terminal
      const existingTimeout = tabFocusTimeoutRef.current.get(newTerminalId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const timeoutId = setTimeout(() => {
        const terminalRef = terminalSessionRefs.current.get(newTerminalId);
        if (terminalRef) {
          terminalRef.focus();
        }
        tabFocusTimeoutRef.current.delete(newTerminalId);
      }, 150);
      tabFocusTimeoutRef.current.set(newTerminalId, timeoutId);
    }
  }, [createTerminal, currentDirectory]);

  const handleTabCreate = useCallback(
    (directory: string, shell?: string) => {
      const dirName = directory.split("/").pop() || "terminal";
      const newTerminalId = createTerminal(dirName, directory, shell);
      // Focus the new terminal after creation
      if (newTerminalId) {
        setTimeout(() => {
          const terminalRef = terminalSessionRefs.current.get(newTerminalId);
          if (terminalRef) {
            terminalRef.focus();
          }
        }, 150);
      }
    },
    [createTerminal],
  );

  // Restore persisted terminals or create initial terminal on mount
  useEffect(() => {
    if (!hasInitializedRef.current && terminals.length === 0) {
      hasInitializedRef.current = true;

      // Try to restore persisted terminals
      const persistedTerminals = getPersistedTerminals();
      if (persistedTerminals.length > 0) {
        restoreTerminalsFromPersisted(persistedTerminals);
      } else {
        // No persisted terminals, create a new one
        handleNewTerminal();
      }
    }
  }, [terminals.length, handleNewTerminal, getPersistedTerminals, restoreTerminalsFromPersisted]);

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
      // Clear any existing timeout for this terminal
      const existingTimeout = tabFocusTimeoutRef.current.get(terminalId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      // Focus the terminal after a short delay to ensure it's rendered
      const timeoutId = setTimeout(() => {
        const terminalRef = terminalSessionRefs.current.get(terminalId);
        if (terminalRef) {
          terminalRef.focus();
        }
        tabFocusTimeoutRef.current.delete(terminalId);
      }, 50);
      tabFocusTimeoutRef.current.set(terminalId, timeoutId);
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
      const companionId = createTerminal(
        companionName,
        activeTerminal.currentDirectory,
        activeTerminal.shell,
      );
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
      const terminalName = name || "Install";
      const newTerminalId = createTerminal(terminalName, currentDirectory);

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
  }, [createTerminal, currentDirectory, setIsBottomPaneVisible]);

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

    const handleSplitTerminalEvent = () => {
      handleSplitView();
    };

    const handleActivateTerminalTab = (event: Event) => {
      const tabIndex = (event as CustomEvent<number>).detail;
      if (typeof tabIndex !== "number" || tabIndex < 0 || tabIndex >= terminals.length) return;
      setActiveTerminal(terminals[tabIndex].id);
    };

    window.addEventListener("terminal-new", handleNewTerminalEvent);
    window.addEventListener("terminal-split", handleSplitTerminalEvent);
    window.addEventListener("terminal-activate-tab", handleActivateTerminalTab);

    return () => {
      window.removeEventListener("terminal-new", handleNewTerminalEvent);
      window.removeEventListener("terminal-split", handleSplitTerminalEvent);
      window.removeEventListener("terminal-activate-tab", handleActivateTerminalTab);
    };
  }, [terminals, handleNewTerminal, setActiveTerminal, handleSplitView]);

  // Auto-create first terminal when the pane becomes visible
  useEffect(() => {
    if (terminals.length === 0 && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      // Try to restore persisted terminals
      const persistedTerminals = getPersistedTerminals();
      if (persistedTerminals.length > 0) {
        restoreTerminalsFromPersisted(persistedTerminals);
      } else {
        // No persisted terminals, create a new one
        const dirName = currentDirectory.split("/").pop() || "terminal";
        createTerminal(dirName, currentDirectory);
      }
    }
  }, [
    terminals.length,
    currentDirectory,
    createTerminal,
    getPersistedTerminals,
    restoreTerminalsFromPersisted,
  ]);

  // Create terminal when pane becomes visible with no terminals
  useEffect(() => {
    const isTerminalVisible = isBottomPaneVisible && bottomPaneActiveTab === "terminal";
    const justBecameVisible = isTerminalVisible && !wasVisibleRef.current;

    if (justBecameVisible && terminals.length === 0 && hasInitializedRef.current) {
      handleNewTerminal();
    }

    wasVisibleRef.current = isTerminalVisible;
  }, [isBottomPaneVisible, bottomPaneActiveTab, terminals.length, handleNewTerminal]);

  return (
    <div
      className={`terminal-container flex h-full flex-col overflow-hidden ${className}`}
      data-terminal-container="active"
    >
      {/* Terminal Tab Bar */}
      <TerminalTabBar
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={reorderTerminals}
        onTabPin={handleTabPin}
        onTabRename={handleTabRename}
        onNewTerminal={handleNewTerminal}
        onTabCreate={handleTabCreate}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseTabsToRight={handleCloseTabsToRight}
        onSplitView={handleSplitView}
        onSearchTerminal={handleSearchTerminal}
        onFullScreen={onFullScreen}
        isFullScreen={isFullScreen}
        isSplitView={terminals.find((t) => t.id === activeTerminalId)?.splitMode || false}
      />

      {/* Terminal Sessions */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-primary-bg"
        style={{
          transform: `scale(${zoomLevel})`,
          transformOrigin: "top left",
          width: `${100 / zoomLevel}%`,
        }}
      >
        {(() => {
          return (
            <div className="h-full">
              {terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className="h-full"
                  style={{
                    display: terminal.id === activeTerminalId ? "flex" : "none",
                  }}
                >
                  <div
                    className={cn(
                      "w-full",
                      terminal.splitMode && terminal.splitWithId && "w-1/2 border-border border-r",
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
                      const companionTerminal = terminals.find(
                        (t) => t.id === terminal.splitWithId,
                      );
                      if (!companionTerminal) return null;
                      return (
                        <div className="w-1/2">
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
    </div>
  );
};

export default TerminalContainer;

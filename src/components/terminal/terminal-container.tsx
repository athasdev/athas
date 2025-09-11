import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalTabs } from "@/hooks/use-terminal-tabs";
import { useUIState } from "@/stores/ui-state-store";
import { useZoomStore } from "@/stores/zoom-store";
import { cn } from "@/utils/cn";
import TerminalSession from "./terminal-session";
import TerminalTabBar from "./terminal-tab-bar";

interface TerminalContainerProps {
  currentDirectory?: string;
  className?: string;
  onClosePanel?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

const TerminalContainer = ({
  currentDirectory = "/",
  className = "",
  onClosePanel,
  onFullScreen,
  isFullScreen = false,
}: TerminalContainerProps) => {
  const {
    terminals,
    activeTerminalId,
    createTerminal,
    closeTerminal,
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

  const zoomLevel = useZoomStore.use.terminalZoomLevel();

  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [newTerminalName, setNewTerminalName] = useState("");
  const hasInitializedRef = useRef(false);
  const terminalSessionRefs = useRef<Map<string, { focus: () => void }>>(new Map());
  const { registerTerminalFocus, clearTerminalFocus } = useUIState();

  const handleNewTerminal = useCallback(() => {
    const dirName = currentDirectory.split("/").pop() || "terminal";
    const newTerminalId = createTerminal(dirName, currentDirectory);
    // Focus the new terminal after creation
    if (newTerminalId) {
      setTimeout(() => {
        const terminalRef = terminalSessionRefs.current.get(newTerminalId);
        if (terminalRef) {
          terminalRef.focus();
        }
      }, 150);
    }
  }, [createTerminal, currentDirectory]);

  // Create initial terminal on mount if none exist
  useEffect(() => {
    if (!hasInitializedRef.current && terminals.length === 0) {
      hasInitializedRef.current = true;
      handleNewTerminal();
    }
  }, [terminals.length, handleNewTerminal]);

  const handleTabClick = useCallback(
    (terminalId: string) => {
      setActiveTerminal(terminalId);
      // Focus the terminal after a short delay to ensure it's rendered
      setTimeout(() => {
        const terminalRef = terminalSessionRefs.current.get(terminalId);
        if (terminalRef) {
          terminalRef.focus();
        }
      }, 50);
    },
    [setActiveTerminal],
  );

  const handleTabClose = useCallback(
    (terminalId: string, event: React.MouseEvent) => {
      event.stopPropagation();
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

  const confirmRename = useCallback(() => {
    if (renamingTerminalId && newTerminalName.trim()) {
      updateTerminalName(renamingTerminalId, newTerminalName.trim());
    }
    setRenamingTerminalId(null);
    setNewTerminalName("");
  }, [renamingTerminalId, newTerminalName, updateTerminalName]);

  const cancelRename = useCallback(() => {
    setRenamingTerminalId(null);
    setNewTerminalName("");
  }, []);

  const handleSplitView = useCallback(() => {
    if (!activeTerminalId) return;

    const activeTerminal = terminals.find((t) => t.id === activeTerminalId);
    if (!activeTerminal) return;

    if (activeTerminal.splitMode) {
      // Toggle off split view for this terminal
      setTerminalSplitMode(activeTerminalId, false);
    } else {
      // Always create a companion terminal for split view within the same tab
      // This creates a virtual split, not a new tab
      const companionId = `${activeTerminalId}_split`;
      setTerminalSplitMode(activeTerminalId, true, companionId);
    }
  }, [activeTerminalId, terminals, setTerminalSplitMode]);

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
    (terminalId: string, ref: { focus: () => void } | null) => {
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

  // Terminal-specific keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle terminal tab navigation regardless of focus (when bottom pane is visible)
      const isBottomPaneVisible = document.querySelector('[data-terminal-container="active"]');
      if (isBottomPaneVisible) {
        // Terminal tab navigation with Ctrl+Tab and Ctrl+Shift+Tab
        if (e.ctrlKey && e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            switchToPrevTerminal();
          } else {
            switchToNextTerminal();
          }
          return;
        }
      }

      // Only handle other shortcuts when the terminal container or its children have focus
      const terminalContainer = document.querySelector('[data-terminal-container="active"]');
      if (!terminalContainer || !terminalContainer.contains(document.activeElement)) {
        return;
      }

      // Cmd+T (Mac) or Ctrl+T (Windows/Linux) to create new terminal
      if ((e.metaKey || e.ctrlKey) && e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        handleNewTerminal();
        return;
      }

      // Cmd+N (Mac) or Ctrl+N (Windows/Linux) to create new terminal (alternative)
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        handleNewTerminal();
        return;
      }

      // Cmd+W (Mac) or Ctrl+W (Windows/Linux) to close current terminal
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        if (activeTerminalId) {
          closeTerminal(activeTerminalId);
        }
        return;
      }

      // Cmd+Shift+T (Mac) or Ctrl+Shift+T (Windows/Linux) to create new terminal (backup)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        handleNewTerminal();
        return;
      }

      // Cmd+Shift+W (Mac) or Ctrl+Shift+W (Windows/Linux) to close current terminal (backup)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "W") {
        e.preventDefault();
        if (activeTerminalId) {
          closeTerminal(activeTerminalId);
        }
        return;
      }

      // Terminal tab navigation with Cmd/Ctrl + [ and ]
      if ((e.metaKey || e.ctrlKey) && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        if (e.key === "]") {
          switchToNextTerminal();
        } else {
          switchToPrevTerminal();
        }
        return;
      }

      // Terminal tab navigation with Alt+Left/Right
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowRight") {
          switchToNextTerminal();
        } else {
          switchToPrevTerminal();
        }
        return;
      }

      // Alternative: Ctrl+PageUp/PageDown for terminal navigation
      if (e.ctrlKey && (e.key === "PageUp" || e.key === "PageDown")) {
        e.preventDefault();
        if (e.key === "PageDown") {
          switchToNextTerminal();
        } else {
          switchToPrevTerminal();
        }
        return;
      }

      // Cmd+D (Mac) or Ctrl+D (Windows/Linux) to toggle split view
      if ((e.metaKey || e.ctrlKey) && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        handleSplitView();
        return;
      }

      // Number shortcuts: Cmd/Ctrl+1, Cmd/Ctrl+2, etc. to switch to specific terminal tabs
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < terminals.length) {
          setActiveTerminal(terminals[tabIndex].id);
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTerminalId,
    terminals,
    handleNewTerminal,
    closeTerminal,
    setActiveTerminal,
    switchToNextTerminal,
    switchToPrevTerminal,
    handleSplitView,
  ]);

  // Auto-create first terminal when the pane becomes visible
  useEffect(() => {
    if (terminals.length === 0 && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const dirName = currentDirectory.split("/").pop() || "terminal";
      createTerminal(dirName, currentDirectory);
    }
  }, [terminals.length, currentDirectory, createTerminal]);

  // Create first terminal if none exist (fallback UI)
  if (terminals.length === 0) {
    return (
      <div className={`flex h-full flex-col ${className}`} data-terminal-container="active">
        <TerminalTabBar
          terminals={[]}
          activeTerminalId={null}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={reorderTerminals}
          onTabPin={handleTabPin}
          onNewTerminal={handleNewTerminal}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
        />
        <div className="flex flex-1 items-center justify-center text-text-lighter">
          <div className="text-center">
            <p className="mb-4 text-xs">No terminal sessions</p>
            <button
              onClick={handleNewTerminal}
              className="rounded bg-selected px-2 py-1 text-text text-xs transition-colors hover:bg-hover"
            >
              Create Terminal
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col ${className}`} data-terminal-container="active">
      {/* Terminal Tab Bar */}
      <TerminalTabBar
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={reorderTerminals}
        onTabPin={handleTabPin}
        onNewTerminal={handleNewTerminal}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseTabsToRight={handleCloseTabsToRight}
        onSplitView={handleSplitView}
        onFullScreen={onFullScreen}
        isFullScreen={isFullScreen}
        onClosePanel={onClosePanel}
        isSplitView={terminals.find((t) => t.id === activeTerminalId)?.splitMode || false}
      />

      {/* Terminal Sessions */}
      <div
        className="relative bg-primary-bg"
        style={{
          //height: "calc(100% - 28px)",
          transform: `scale(${zoomLevel})`,
          transformOrigin: "top left",
          width: `${100 / zoomLevel}%`,
          height: `${100 / zoomLevel}%`,
        }}
      >
        {(() => {
          return (
            <div className="h-full">
              {terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  className="h-full"
                  style={{ display: terminal.id === activeTerminalId ? "flex" : "none" }}
                >
                  <div
                    className={cn(
                      "w-full pl-[16px]",
                      terminal.splitMode && terminal.splitWithId && "w-1/2 border-border border-r",
                    )}
                  >
                    <TerminalSession
                      key={terminal.id}
                      terminal={terminal}
                      isActive={terminal.id === activeTerminalId}
                      onDirectoryChange={handleDirectoryChange}
                      onActivity={handleActivity}
                      onRegisterRef={registerTerminalRef}
                    />
                  </div>
                  {terminal.splitMode && terminal.splitWithId && (
                    <div className="w-1/2 pl-[16px]">
                      <TerminalSession
                        key={terminal.splitWithId}
                        terminal={{
                          ...terminal,
                          id: terminal.splitWithId,
                          name: `${terminal.name} (split)`,
                        }}
                        isActive={terminal.id === activeTerminalId}
                        onDirectoryChange={handleDirectoryChange}
                        onActivity={handleActivity}
                        onRegisterRef={registerTerminalRef}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Rename Modal */}
      {renamingTerminalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="min-w-[300px] rounded-lg border border-border bg-secondary-bg p-4">
            <h3 className="mb-3 font-medium text-sm text-text">Rename Terminal</h3>
            <input
              type="text"
              value={newTerminalName}
              onChange={(e) => setNewTerminalName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  confirmRename();
                } else if (e.key === "Escape") {
                  cancelRename();
                }
              }}
              className="w-full rounded border border-border bg-primary-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Terminal name"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={cancelRename}
                className="px-3 py-1.5 text-text-lighter text-xs transition-colors hover:text-text"
              >
                Cancel
              </button>
              <button
                onClick={confirmRename}
                className="rounded bg-blue-500 px-3 py-1.5 text-white text-xs transition-colors hover:bg-blue-600"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalContainer;

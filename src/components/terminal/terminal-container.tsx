import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalTabs } from "../../hooks/use-terminal-tabs";
import { useUIState } from "../../stores/ui-state-store";
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
  } = useTerminalTabs();

  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [newTerminalName, setNewTerminalName] = useState("");
  const [isSplitView, setIsSplitView] = useState(false);
  const hasInitializedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerTerminalFocus, clearTerminalFocus } = useUIState();

  // Map to store terminal refs for focus management
  const terminalRefs = useRef<Map<string, { focus: () => void; resize: () => void }>>(new Map());

  // Simple focus management
  const focusActiveTerminal = useCallback(() => {
    if (!activeTerminalId) return;

    const terminalRef = terminalRefs.current.get(activeTerminalId);
    if (terminalRef) {
      terminalRef.focus();
    }
  }, [activeTerminalId]);

  // Register focus callback
  useEffect(() => {
    registerTerminalFocus(focusActiveTerminal);
    return () => clearTerminalFocus();
  }, [registerTerminalFocus, clearTerminalFocus, focusActiveTerminal]);

  const handleNewTerminal = useCallback(() => {
    const dirName = currentDirectory.split("/").pop() || "terminal";
    createTerminal(dirName, currentDirectory);
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
      // Focus after a small delay to ensure terminal is ready
      setTimeout(() => {
        const terminalRef = terminalRefs.current.get(terminalId);
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
      // Remove from refs map
      terminalRefs.current.delete(terminalId);
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
          terminalRefs.current.delete(terminal.id);
          closeTerminal(terminal.id);
        }
      });
    },
    [terminals, closeTerminal],
  );

  const handleCloseAllTabs = useCallback(() => {
    terminals.forEach((terminal) => {
      if (!terminal.isPinned) {
        terminalRefs.current.delete(terminal.id);
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
          terminalRefs.current.delete(terminal.id);
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
    if (terminals.length >= 2) {
      setIsSplitView((prev) => !prev);
      // Trigger resize on all terminals after layout change
      setTimeout(() => {
        terminalRefs.current.forEach((ref) => ref.resize());
      }, 100);
    } else {
      const dirName = currentDirectory.split("/").pop() || "terminal";
      createTerminal(dirName, currentDirectory);
      setTimeout(() => {
        setIsSplitView(true);
        // Trigger resize after split view is enabled
        setTimeout(() => {
          terminalRefs.current.forEach((ref) => ref.resize());
        }, 100);
      }, 100);
    }
  }, [terminals.length, currentDirectory, createTerminal]);

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

  const registerTerminalRef = useCallback(
    (terminalId: string, ref: { focus: () => void; resize: () => void } | null) => {
      if (ref) {
        terminalRefs.current.set(terminalId, ref);
      } else {
        terminalRefs.current.delete(terminalId);
      }
    },
    [],
  );

  // Terminal-specific keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when the terminal container or its children have focus
      const terminalContainer = containerRef.current;
      if (!terminalContainer || !terminalContainer.contains(document.activeElement)) {
        return;
      }

      // Cmd+T (Mac) or Ctrl+T (Windows/Linux) to create new terminal
      if ((e.metaKey || e.ctrlKey) && e.key === "t" && !e.shiftKey) {
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
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTerminalId,
    handleNewTerminal,
    closeTerminal,
    switchToNextTerminal,
    switchToPrevTerminal,
  ]);

  // Resize terminals when split view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      terminalRefs.current.forEach((ref) => ref.resize());
    }, 100);
    return () => clearTimeout(timer);
  }, [isSplitView]);

  if (terminals.length === 0) {
    return (
      <div ref={containerRef} className={`flex h-full flex-col ${className}`}>
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
    <div ref={containerRef} className={`flex h-full flex-col ${className}`}>
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
      />

      {/* Terminal Sessions */}
      <div className="relative flex-1 overflow-hidden">
        {isSplitView && terminals.length >= 2 ? (
          // Split view: Show active terminal on left, next terminal on right
          <div className="flex h-full">
            <div className="relative w-1/2 overflow-hidden border-border border-r">
              {terminals
                .filter((t) => t.id === activeTerminalId)
                .map((terminal) => (
                  <TerminalSession
                    key={terminal.id}
                    terminal={terminal}
                    isActive={true}
                    onDirectoryChange={handleDirectoryChange}
                    onActivity={handleActivity}
                    onRegisterRef={registerTerminalRef}
                  />
                ))}
            </div>
            <div className="relative w-1/2 overflow-hidden">
              {terminals
                .filter((t) => t.id !== activeTerminalId)
                .slice(0, 1)
                .map((terminal) => (
                  <TerminalSession
                    key={terminal.id}
                    terminal={terminal}
                    isActive={false}
                    onDirectoryChange={handleDirectoryChange}
                    onActivity={handleActivity}
                    onRegisterRef={registerTerminalRef}
                  />
                ))}
            </div>
          </div>
        ) : (
          // Normal view: All terminals rendered but only active one visible
          <div className="relative h-full">
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className="absolute inset-0"
                style={{
                  opacity: terminal.id === activeTerminalId ? 1 : 0,
                  pointerEvents: terminal.id === activeTerminalId ? "auto" : "none",
                  zIndex: terminal.id === activeTerminalId ? 1 : 0,
                }}
              >
                <TerminalSession
                  terminal={terminal}
                  isActive={terminal.id === activeTerminalId}
                  onDirectoryChange={handleDirectoryChange}
                  onActivity={handleActivity}
                  onRegisterRef={registerTerminalRef}
                />
              </div>
            ))}
          </div>
        )}
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

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalTabs } from "../../hooks/use-terminal-tabs";
import TerminalSession from "./terminal-session";
import TerminalTabBar from "./terminal-tab-bar";

interface TerminalContainerProps {
  currentDirectory?: string;
  className?: string;
}

const TerminalContainer = ({ currentDirectory = "/", className = "" }: TerminalContainerProps) => {
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
  const hasInitializedRef = useRef(false);

  const handleNewTerminal = useCallback(() => {
    const dirName = currentDirectory.split("/").pop() || "terminal";
    createTerminal(dirName, currentDirectory);
  }, [createTerminal, currentDirectory]);

  const handleTabClick = useCallback(
    (terminalId: string) => {
      setActiveTerminal(terminalId);
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
      const terminal = terminals.find(t => t.id === terminalId);
      if (terminal) {
        pinTerminal(terminalId, !terminal.isPinned);
      }
    },
    [terminals, pinTerminal],
  );

  const handleCloseOtherTabs = useCallback(
    (terminalId: string) => {
      terminals.forEach(terminal => {
        if (terminal.id !== terminalId && !terminal.isPinned) {
          closeTerminal(terminal.id);
        }
      });
    },
    [terminals, closeTerminal],
  );

  const handleCloseAllTabs = useCallback(() => {
    terminals.forEach(terminal => {
      if (!terminal.isPinned) {
        closeTerminal(terminal.id);
      }
    });
  }, [terminals, closeTerminal]);

  const handleCloseTabsToRight = useCallback(
    (terminalId: string) => {
      const targetIndex = terminals.findIndex(t => t.id === terminalId);
      if (targetIndex === -1) return;

      terminals.slice(targetIndex + 1).forEach(terminal => {
        if (!terminal.isPinned) {
          closeTerminal(terminal.id);
        }
      });
    },
    [terminals, closeTerminal],
  );

  const handleRenameTerminal = useCallback(
    (terminalId: string) => {
      const terminal = terminals.find(t => t.id === terminalId);
      if (terminal) {
        setRenamingTerminalId(terminalId);
        setNewTerminalName(terminal.name);
      }
    },
    [terminals],
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

  // Terminal-specific keyboard shortcuts
  // Terminal-specific keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when the terminal container or its children have focus
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
      <div className={`flex flex-col h-full ${className}`} data-terminal-container="active">
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
          onRenameTerminal={handleRenameTerminal}
        />
        <div className="flex-1 flex items-center justify-center text-[var(--text-lighter)]">
          <div className="text-center">
            <p className="mb-4 text-xs">No terminal sessions</p>
            <button
              onClick={handleNewTerminal}
              className="px-2 py-1 text-xs bg-[var(--selected-color)] text-[var(--text-color)] rounded hover:bg-[var(--hover-color)] transition-colors"
            >
              Create Terminal
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`} data-terminal-container="active">
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
        onRenameTerminal={handleRenameTerminal}
      />

      {/* Terminal Sessions */}
      <div className="flex-1 relative">
        {terminals.map(terminal => (
          <TerminalSession
            key={terminal.id}
            terminal={terminal}
            isActive={terminal.id === activeTerminalId}
            onDirectoryChange={handleDirectoryChange}
            onActivity={handleActivity}
          />
        ))}
      </div>

      {/* Rename Modal */}
      {renamingTerminalId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-lg p-4 min-w-[300px]">
            <h3 className="text-sm font-medium text-[var(--text-color)] mb-3">Rename Terminal</h3>
            <input
              type="text"
              value={newTerminalName}
              onChange={e => setNewTerminalName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  confirmRename();
                } else if (e.key === "Escape") {
                  cancelRename();
                }
              }}
              className="w-full px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-[var(--text-color)]"
              placeholder="Terminal name"
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={cancelRename}
                className="px-3 py-1.5 text-xs text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRename}
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
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

import { Pin, PinOff, Plus, Terminal as TerminalIcon, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Terminal } from "../../types/terminal";
import { cn } from "../../utils/cn";

interface TerminalContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  terminal: Terminal | null;
  onClose: () => void;
  onPin: (terminalId: string) => void;
  onCloseTab: (terminalId: string) => void;
  onCloseOthers: (terminalId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (terminalId: string) => void;
  onRename: (terminalId: string) => void;
}

const TerminalContextMenu = ({
  isOpen,
  position,
  terminal,
  onClose,
  onPin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
  onRename,
}: TerminalContextMenuProps) => {
  useEffect(() => {
    if (isOpen) {
      const handleClickOutside = () => onClose();
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };

      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleEscape);

      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen || !terminal) return null;

  return (
    <div
      className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[160px] text-[var(--text-color)]"
      style={{ left: position.x, top: position.y }}
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onRename(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)] flex items-center gap-2"
      >
        Rename Terminal
      </button>

      <div className="h-px bg-[var(--border-color)] my-1" />

      <button
        onClick={() => {
          onPin(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)] flex items-center gap-2"
      >
        {terminal.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {terminal.isPinned ? "Unpin Terminal" : "Pin Terminal"}
      </button>

      <div className="h-px bg-[var(--border-color)] my-1" />

      <button
        onClick={() => {
          onCloseTab(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)]"
      >
        Close Terminal
      </button>
      <button
        onClick={() => {
          onCloseOthers(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)]"
      >
        Close Other Terminals
      </button>
      <button
        onClick={() => {
          onCloseToRight(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)]"
      >
        Close Terminals to the Right
      </button>
      <button
        onClick={() => {
          onCloseAll();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--hover-color)] text-red-400"
      >
        Close All Terminals
      </button>
    </div>
  );
};

interface TerminalTabBarProps {
  terminals: Terminal[];
  activeTerminalId: string | null;
  onTabClick: (terminalId: string) => void;
  onTabClose: (terminalId: string, event: React.MouseEvent) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTabPin?: (terminalId: string) => void;
  onNewTerminal?: () => void;
  onCloseOtherTabs?: (terminalId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTabsToRight?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string) => void;
}

const TerminalTabBar = ({
  terminals,
  activeTerminalId,
  onTabClick,
  onTabClose,
  onTabReorder,
  onTabPin,
  onNewTerminal,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onRenameTerminal,
}: TerminalTabBarProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    terminal: Terminal | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, terminal: null });

  const tabBarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
      return;
    }

    e.preventDefault();
    setDraggedIndex(index);
    setDragStartPosition({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (draggedIndex === null || !dragStartPosition || !tabBarRef.current) return;

    const distance = Math.sqrt(
      (e.clientX - dragStartPosition.x) ** 2 + (e.clientY - dragStartPosition.y) ** 2,
    );

    if (distance > 5 && !isDragging) {
      setIsDragging(true);
    }

    if (isDragging) {
      const rect = tabBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const tabElements = Array.from(tabBarRef.current.children) as HTMLElement[];

      let newDropTarget: number | null = null;
      for (let i = 0; i < tabElements.length - 1; i++) {
        // -1 to exclude the new terminal button
        const tabRect = tabElements[i].getBoundingClientRect();
        const tabX = tabRect.left - rect.left;
        const tabWidth = tabRect.width;

        if (x >= tabX && x <= tabX + tabWidth) {
          newDropTarget = i;
          break;
        }
      }

      if (newDropTarget !== draggedIndex) {
        setDropTarget(newDropTarget);
      }
    }
  };

  const handleMouseUp = () => {
    if (
      draggedIndex !== null &&
      dropTarget !== null &&
      dropTarget !== draggedIndex &&
      onTabReorder
    ) {
      onTabReorder(draggedIndex, dropTarget);
    }

    setIsDragging(false);
    setDraggedIndex(null);
    setDropTarget(null);
    setDragStartPosition(null);
  };

  const handleContextMenu = (e: React.MouseEvent, terminal: Terminal) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      terminal,
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, terminal: null });
  };

  // Sort terminals: pinned tabs first, then regular tabs
  const sortedTerminals = [...terminals].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, draggedIndex, dragStartPosition]);

  if (terminals.length === 0) {
    return (
      <div className="flex items-center justify-between bg-[var(--secondary-bg)] border-b border-[var(--border-color)] px-2 py-1 min-h-[28px]">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={10} className="text-[var(--text-lighter)]" />
          <span className="text-xs font-mono text-[var(--text-lighter)]">No terminals</span>
        </div>
        {onNewTerminal && (
          <button
            onClick={onNewTerminal}
            className="flex items-center gap-0.5 px-1.5 py-1 text-xs rounded hover:bg-[var(--hover-color)] transition-colors text-[var(--text-lighter)]"
            title="New Terminal (Cmd+T)"
          >
            <Plus size={9} />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        ref={tabBarRef}
        className="flex items-center bg-[var(--secondary-bg)] border-b border-[var(--border-color)] px-0.5 overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--border-color)] min-h-[28px]"
        style={{
          scrollbarWidth: "thin",
          scrollbarGutter: "stable",
        }}
      >
        {sortedTerminals.map((terminal, index) => {
          const isActive = terminal.id === activeTerminalId;
          const isDraggedOver = dropTarget === index && isDragging;
          const isDraggedItem = draggedIndex === index && isDragging;

          return (
            <div
              key={terminal.id}
              className={cn(
                "flex items-center gap-1 px-1.5 py-1 text-xs border-r border-[var(--border-color)] cursor-pointer select-none min-w-0 max-w-[180px] transition-all duration-150",
                isActive
                  ? "bg-[var(--selected-color)] text-[var(--text-color)]"
                  : "text-[var(--text-lighter)] hover:bg-[var(--hover-color)] hover:text-[var(--text-color)]",
                isDraggedItem && "opacity-50 scale-95",
                isDraggedOver && "bg-blue-500/20 border-blue-500/50",
                terminal.isPinned && "border-l-2 border-l-blue-500",
              )}
              onMouseDown={e => handleMouseDown(e, index)}
              onClick={() => onTabClick(terminal.id)}
              onContextMenu={e => handleContextMenu(e, terminal)}
              title={`${terminal.name}\n${terminal.currentDirectory}`}
            >
              <TerminalIcon size={12} className="flex-shrink-0" />

              <span className="truncate font-mono text-xs">{terminal.name}</span>

              {terminal.isPinned && <Pin size={12} className="flex-shrink-0 text-blue-400" />}

              <button
                onClick={e => {
                  e.stopPropagation();
                  onTabClose(terminal.id, e);
                }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--border-color)] hover:text-red-400 transition-colors opacity-60 hover:opacity-100 cursor-pointer"
                title="Close Terminal"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* New Terminal Button */}
        {onNewTerminal && (
          <button
            onClick={onNewTerminal}
            className="flex items-center gap-0.5 p-1.5 text-xs rounded hover:bg-[var(--hover-color)] transition-colors text-[var(--text-lighter)] flex-shrink-0 ml-0.5 cursor-pointer"
            title="New Terminal (Cmd+T)"
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      <TerminalContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        terminal={contextMenu.terminal}
        onClose={closeContextMenu}
        onPin={terminalId => {
          onTabPin?.(terminalId);
        }}
        onCloseTab={terminalId => {
          onTabClose(terminalId, {} as React.MouseEvent);
        }}
        onCloseOthers={onCloseOtherTabs || (() => {})}
        onCloseAll={onCloseAllTabs || (() => {})}
        onCloseToRight={onCloseTabsToRight || (() => {})}
        onRename={onRenameTerminal || (() => {})}
      />
    </>
  );
};

export default TerminalTabBar;

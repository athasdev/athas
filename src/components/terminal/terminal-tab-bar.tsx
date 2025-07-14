import {
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Plus,
  SplitSquareHorizontal,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
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
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-secondary-bg py-1 text-text shadow-lg"
      style={{ left: position.x, top: position.y }}
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onRename(terminal.id);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover"
      >
        Rename Terminal
      </button>

      <div className="my-1 h-px bg-border" />

      <button
        onClick={() => {
          onPin(terminal.id);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover"
      >
        {terminal.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {terminal.isPinned ? "Unpin Terminal" : "Pin Terminal"}
      </button>

      <div className="my-1 h-px bg-border" />

      <button
        onClick={() => {
          onCloseTab(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover"
      >
        Close Terminal
      </button>
      <button
        onClick={() => {
          onCloseOthers(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover"
      >
        Close Other Terminals
      </button>
      <button
        onClick={() => {
          onCloseToRight(terminal.id);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover"
      >
        Close Terminals to the Right
      </button>
      <button
        onClick={() => {
          onCloseAll();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left text-red-400 text-xs hover:bg-hover"
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
  onSplitView?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
  onClosePanel?: () => void;
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
  onSplitView,
  onFullScreen,
  isFullScreen = false,
  onClosePanel,
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
      <div className="flex min-h-[28px] items-center justify-between border-border border-b bg-secondary-bg px-2 py-1">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={10} className="text-text-lighter" />
          <span className="font-mono text-text-lighter text-xs">No terminals</span>
        </div>
        {onNewTerminal && (
          <button
            onClick={onNewTerminal}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-text-lighter text-xs transition-colors hover:bg-hover"
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
        className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border flex min-h-[24px] items-center justify-between overflow-x-auto border-border border-b bg-secondary-bg px-1"
        style={{
          scrollbarWidth: "thin",
          scrollbarGutter: "stable",
        }}
      >
        {/* Left side - Terminal tabs */}
        <div className="flex items-center overflow-x-auto">
          {sortedTerminals.map((terminal, index) => {
            const isActive = terminal.id === activeTerminalId;
            const isDraggedOver = dropTarget === index && isDragging;
            const isDraggedItem = draggedIndex === index && isDragging;

            return (
              <div
                key={terminal.id}
                className={cn(
                  "flex min-w-0 max-w-[140px] cursor-pointer select-none items-center gap-1 px-2 py-1 text-xs transition-all duration-150",
                  isActive
                    ? "bg-selected text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                  isDraggedItem && "scale-95 opacity-50",
                  isDraggedOver && "bg-blue-500/20",
                  terminal.isPinned && "border-l-2 border-l-blue-500",
                )}
                onMouseDown={e => handleMouseDown(e, index)}
                onClick={() => onTabClick(terminal.id)}
                onContextMenu={e => handleContextMenu(e, terminal)}
                title={`${terminal.name}\n${terminal.currentDirectory}`}
              >
                <span className="truncate font-mono text-xs">{terminal.name}</span>
                {terminal.isPinned && <Pin size={10} className="flex-shrink-0 text-blue-400" />}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onTabClose(terminal.id, e);
                  }}
                  className="flex-shrink-0 cursor-pointer rounded p-0.5 opacity-60 transition-colors hover:bg-border hover:text-red-400 hover:opacity-100"
                  title="Close Terminal"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Right side - Action buttons */}
        <div className="flex items-center gap-0.5">
          {/* New Terminal Button */}
          {onNewTerminal && (
            <button
              onClick={onNewTerminal}
              className="flex flex-shrink-0 cursor-pointer items-center rounded p-1 text-text-lighter transition-colors hover:bg-hover"
              title="New Terminal (Cmd+T)"
            >
              <Plus size={12} />
            </button>
          )}

          {/* Split View Button */}
          {onSplitView && (
            <button
              onClick={onSplitView}
              className="flex flex-shrink-0 cursor-pointer items-center rounded p-1 text-text-lighter transition-colors hover:bg-hover"
              title="Split Terminal View"
            >
              <SplitSquareHorizontal size={12} />
            </button>
          )}

          {/* Full Screen Button */}
          {onFullScreen && (
            <button
              onClick={onFullScreen}
              className="flex flex-shrink-0 cursor-pointer items-center rounded p-1 text-text-lighter transition-colors hover:bg-hover"
              title={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
            >
              {isFullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}

          {/* Close Panel Button */}
          {onClosePanel && (
            <button
              onClick={onClosePanel}
              className="flex flex-shrink-0 cursor-pointer items-center rounded p-1 text-text-lighter transition-colors hover:bg-hover"
              title="Close Panel"
            >
              <X size={12} />
            </button>
          )}
        </div>
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

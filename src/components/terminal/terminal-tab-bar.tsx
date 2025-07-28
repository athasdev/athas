import {
  Copy,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  SplitSquareHorizontal,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import type { Terminal } from "../../types/terminal";
import { cn } from "../../utils/cn";
import KeybindingBadge from "../ui/keybinding-badge";
import Tooltip from "../ui/tooltip";

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
}: TerminalContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !terminal) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-[180px] border border-border bg-secondary-bg py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onPin(terminal.id);
          onClose();
        }}
      >
        {terminal.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {terminal.isPinned ? "Unpin Terminal" : "Pin Terminal"}
      </button>

      <div className="my-1 border-border border-t" />

      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          // Duplicate terminal with same directory
          onClose();
        }}
      >
        <Copy size={12} />
        Duplicate Terminal
      </button>

      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          // Clear terminal screen
          onClose();
        }}
      >
        <RotateCcw size={12} />
        Clear Terminal
      </button>

      <div className="my-1 border-border border-t" />

      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseTab(terminal.id);
          onClose();
        }}
      >
        <span>Close</span>
        <KeybindingBadge keys={["⌘", "W"]} className="opacity-60" />
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(terminal.id);
          onClose();
        }}
      >
        Close Others
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseToRight(terminal.id);
          onClose();
        }}
      >
        Close to Right
      </button>
      <button
        className="w-full px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseAll();
          onClose();
        }}
      >
        Close All
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
  onSplitView?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
  onClosePanel?: () => void;
  isSplitView?: boolean;
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
  onSplitView,
  onFullScreen,
  isFullScreen = false,
  onClosePanel,
  isSplitView = false,
}: TerminalTabBarProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragCurrentPosition, setDragCurrentPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isDraggedOutside, setIsDraggedOutside] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    terminal: Terminal | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, terminal: null });

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

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

    setDragCurrentPosition({ x: e.clientX, y: e.clientY });

    const distance = Math.sqrt(
      (e.clientX - dragStartPosition.x) ** 2 + (e.clientY - dragStartPosition.y) ** 2,
    );

    if (distance > 5 && !isDragging) {
      setIsDragging(true);
    }

    if (isDragging) {
      const rect = tabBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if dragged outside the tab bar
      const isOutside = x < 0 || x > rect.width || y < -50 || y > rect.height + 50;
      setIsDraggedOutside(isOutside);

      if (!isOutside) {
        // Handle internal reordering
        const tabContainer = tabBarRef.current.querySelector("[data-tab-container]");
        if (tabContainer) {
          const tabElements = Array.from(tabContainer.children) as HTMLElement[];

          let newDropTarget: number | null = null;
          for (let i = 0; i < tabElements.length; i++) {
            const tabRect = tabElements[i].getBoundingClientRect();
            const tabX = tabRect.left - rect.left;
            const tabWidth = tabRect.width;

            // Determine if cursor is in left or right half of the tab
            if (x >= tabX && x <= tabX + tabWidth) {
              const relativeX = x - tabX;
              if (relativeX < tabWidth / 2) {
                newDropTarget = i;
              } else {
                newDropTarget = i + 1;
              }
              break;
            }
          }

          // Clamp drop target to valid range
          if (newDropTarget !== null) {
            newDropTarget = Math.max(0, Math.min(tabElements.length, newDropTarget));
          }

          if (newDropTarget !== dropTarget) {
            setDropTarget(newDropTarget);
          }
        }
      } else {
        setDropTarget(null);
      }
    }
  };

  const handleMouseUp = () => {
    if (draggedIndex !== null) {
      if (!isDraggedOutside && dropTarget !== null && dropTarget !== draggedIndex && onTabReorder) {
        // Adjust dropTarget if moving right (forward)
        let adjustedDropTarget = dropTarget;
        if (draggedIndex < dropTarget) {
          adjustedDropTarget = dropTarget - 1;
        }
        if (adjustedDropTarget !== draggedIndex) {
          onTabReorder(draggedIndex, adjustedDropTarget);
          const movedTerminal = sortedTerminals[draggedIndex];
          if (movedTerminal) {
            onTabClick(movedTerminal.id);
          }
        }
      }
    }

    setIsDragging(false);
    setDraggedIndex(null);
    setDropTarget(null);
    setDragStartPosition(null);
    setDragCurrentPosition(null);
    setIsDraggedOutside(false);
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
    if (draggedIndex === null) return;

    const move = (e: MouseEvent) => handleMouseMove(e);
    const up = () => handleMouseUp();
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);

    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedIndex, dragStartPosition, isDragging, dropTarget]);

  if (terminals.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[28px] items-center justify-between",
          "border-border border-b bg-secondary-bg px-2 py-1",
        )}
      >
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={10} className="text-text-lighter" />
          <span className="font-mono text-text-lighter text-xs">No terminals</span>
        </div>
        {onNewTerminal && (
          <Tooltip content="New Terminal (Cmd+T)" side="bottom">
            <button
              onClick={onNewTerminal}
              className={cn(
                "flex items-center gap-0.5 px-1.5 py-1",
                "text-text-lighter text-xs transition-colors hover:bg-hover",
              )}
            >
              <Plus size={9} />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        ref={tabBarRef}
        className={cn(
          "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border",
          "flex min-h-[28px] items-center justify-between overflow-x-auto",
          "border-border border-b bg-secondary-bg px-1",
        )}
        style={{
          scrollbarWidth: "thin",
          scrollbarGutter: "stable",
        }}
      >
        {/* Left side - Terminal tabs */}
        <div className="scrollbar-hidden flex overflow-x-auto" data-tab-container>
          {sortedTerminals.map((terminal, index) => {
            const isActive = terminal.id === activeTerminalId;
            // Drop indicator should be shown before the tab at dropTarget
            const showDropIndicator =
              dropTarget === index && draggedIndex !== null && !isDraggedOutside;

            return (
              <React.Fragment key={terminal.id}>
                {/* Drop indicator before tab */}
                {showDropIndicator && (
                  <div className="relative flex items-center">
                    <div
                      className="absolute top-0 bottom-0 z-10 h-full w-0.5 bg-accent"
                      style={{ height: "100%" }}
                    />
                  </div>
                )}
                <Tooltip
                  content={`${terminal.name}${terminal.isPinned ? " (Pinned)" : ""}\n${terminal.currentDirectory}`}
                  side="bottom"
                >
                  <div
                    ref={(el) => {
                      tabRefs.current[index] = el;
                    }}
                    className={`group relative flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-3 py-1 transition-all duration-150 ${
                      isActive
                        ? "bg-bg text-text"
                        : "bg-transparent text-text-lighter hover:text-text"
                    } ${terminal.isPinned ? "border-l-2 border-l-blue-500" : ""}`}
                    style={{ minWidth: "120px", maxWidth: "200px" }}
                    onMouseDown={(e) => handleMouseDown(e, index)}
                    onClick={() => {
                      if (!isDragging) {
                        onTabClick(terminal.id);
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, terminal)}
                  >
                    {/* Active tab indicator */}
                    {isActive && (
                      <div className="absolute right-0 bottom-0 left-0 h-[2px] bg-blue-500" />
                    )}

                    {/* Terminal Icon */}
                    <div className="flex-shrink-0">
                      <TerminalIcon size={12} className="text-text-lighter" />
                    </div>

                    {/* Pin indicator */}
                    {terminal.isPinned && <Pin size={8} className="flex-shrink-0 text-blue-500" />}

                    {/* Terminal Name */}
                    <span
                      className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs ${isActive ? "text-text" : "text-text-light"} `}
                      title={terminal.currentDirectory}
                    >
                      {terminal.name}
                    </span>

                    {/* Close Button */}
                    {!terminal.isPinned && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabClose(terminal.id, e);
                        }}
                        className={cn(
                          "flex-shrink-0 cursor-pointer p-0.5",
                          "text-text-lighter opacity-0 transition-all duration-150",
                          "hover:bg-hover hover:text-text hover:opacity-100 group-hover:opacity-100",
                        )}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </Tooltip>
              </React.Fragment>
            );
          })}
          {/* Drop indicator after the last tab */}
          {dropTarget === sortedTerminals.length && draggedIndex !== null && !isDraggedOutside && (
            <div className="relative flex items-center">
              <div
                className="absolute top-0 bottom-0 z-10 w-0.5 bg-accent"
                style={{ height: "100%" }}
              />
            </div>
          )}
        </div>

        {/* Right side - Action buttons */}
        <div className="flex items-center gap-0.5">
          {/* New Terminal Button */}
          {onNewTerminal && (
            <Tooltip content="New Terminal (Cmd+T)" side="bottom">
              <button
                onClick={onNewTerminal}
                className={cn(
                  "flex flex-shrink-0 cursor-pointer items-center p-1",
                  "text-text-lighter transition-colors hover:bg-hover",
                )}
              >
                <Plus size={12} />
              </button>
            </Tooltip>
          )}

          {/* Split View Button */}
          {onSplitView && (
            <Tooltip
              content={isSplitView ? "Exit Split View" : "Split Terminal View (Cmd+D)"}
              side="bottom"
            >
              <button
                onClick={onSplitView}
                className={cn(
                  "flex flex-shrink-0 cursor-pointer items-center p-1",
                  isSplitView
                    ? "bg-selected text-text"
                    : "text-text-lighter transition-colors hover:bg-hover",
                )}
              >
                <SplitSquareHorizontal size={12} />
              </button>
            </Tooltip>
          )}

          {/* Full Screen Button */}
          {onFullScreen && (
            <Tooltip
              content={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
              side="bottom"
            >
              <button
                onClick={onFullScreen}
                className={cn(
                  "flex flex-shrink-0 cursor-pointer items-center p-1",
                  "text-text-lighter transition-colors hover:bg-hover",
                )}
              >
                {isFullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </Tooltip>
          )}

          {/* Close Panel Button */}
          {onClosePanel && (
            <Tooltip content="Close Terminal Panel" side="bottom">
              <button
                onClick={onClosePanel}
                className={cn(
                  "flex flex-shrink-0 cursor-pointer items-center p-1",
                  "text-text-lighter transition-colors hover:bg-hover",
                )}
              >
                <X size={12} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Floating tab name while dragging */}
        {isDragging && draggedIndex !== null && dragCurrentPosition && (
          <div
            ref={(el) => {
              if (el && window) {
                // Center the floating tab on the cursor
                const rect = el.getBoundingClientRect();
                el.style.left = `${dragCurrentPosition.x - rect.width / 2}px`;
                el.style.top = `${dragCurrentPosition.y - rect.height / 2}px`;
              }
            }}
            className="fixed z-50 flex cursor-pointer items-center gap-1.5 border border-border bg-bg px-2 py-1.5 font-mono text-xs shadow-lg"
            style={{
              opacity: 0.95,
              minWidth: 60,
              maxWidth: 220,
              whiteSpace: "nowrap",
              color: "var(--color-text)",
            }}
          >
            {/* Terminal Icon */}
            <span className="flex-shrink-0">
              <TerminalIcon size={12} className="text-text-lighter" />
            </span>
            {/* Pin indicator */}
            {sortedTerminals[draggedIndex].isPinned && (
              <Pin size={8} className="flex-shrink-0 text-blue-500" />
            )}
            <span className="truncate">{sortedTerminals[draggedIndex].name}</span>
          </div>
        )}
      </div>

      <TerminalContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        terminal={contextMenu.terminal}
        onClose={closeContextMenu}
        onPin={(terminalId) => {
          onTabPin?.(terminalId);
        }}
        onCloseTab={(terminalId) => {
          onTabClose(terminalId, {} as React.MouseEvent);
        }}
        onCloseOthers={onCloseOtherTabs || (() => {})}
        onCloseAll={onCloseAllTabs || (() => {})}
        onCloseToRight={onCloseTabsToRight || (() => {})}
      />
    </>
  );
};

export default TerminalTabBar;

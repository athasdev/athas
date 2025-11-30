import { Pin, Terminal as TerminalIcon, X } from "lucide-react";
import { memo, useCallback } from "react";
import type { Terminal } from "@/features/terminal/types/terminal";
import { cn } from "@/utils/cn";

interface TerminalTabBarItemProps {
  terminal: Terminal;
  index: number;
  isActive: boolean;
  isDraggedTab: boolean;
  showDropIndicatorBefore: boolean;
  tabRef: (el: HTMLDivElement | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  handleTabClose: (id: string) => void;
  handleTabPin: (id: string) => void;
}

const TerminalTabBarItem = memo(function TerminalTabBarItem({
  terminal,
  isActive,
  isDraggedTab,
  showDropIndicatorBefore,
  tabRef,
  onMouseDown,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onKeyDown,
  handleTabClose,
  handleTabPin,
}: TerminalTabBarItemProps) {
  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle middle click here
      if (e.button !== 1) return;

      handleTabClose(terminal.id);
    },
    [handleTabClose, terminal.id],
  );

  return (
    <>
      {showDropIndicatorBefore && (
        <div className="relative">
          <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
        </div>
      )}
      <div
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${terminal.name}${terminal.isPinned ? " (pinned)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        className={cn(
          "tab-bar-item group relative flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-border border-r px-2 py-1",
          isActive ? "bg-primary-bg" : "bg-secondary-bg",
          terminal.isPinned ? "border-l-2 border-l-accent" : "",
          isDraggedTab ? "opacity-30" : "opacity-100",
        )}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={handleAuxClick}
      >
        {isActive && <div className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
        {terminal.isPinned && <Pin className="shrink-0 text-accent" size={10} />}
        <TerminalIcon size={12} className="shrink-0 text-text-lighter" />
        <span
          className={cn(
            "ui-font overflow-hidden text-ellipsis whitespace-nowrap text-xs",
            isActive ? "text-text" : "text-text-light",
          )}
          title={terminal.currentDirectory}
        >
          {terminal.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (terminal.isPinned) {
              handleTabPin(terminal.id);
            } else {
              handleTabClose(terminal.id);
            }
          }}
          className={cn(
            "flex size-4 shrink-0 cursor-pointer select-none items-center justify-center rounded transition-opacity",
            "text-text-lighter",
            "hover:bg-hover hover:text-text",
            terminal.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title={terminal.isPinned ? "Unpin terminal" : `Close ${terminal.name}`}
          tabIndex={-1}
          draggable={false}
        >
          {terminal.isPinned ? (
            <Pin className="pointer-events-none select-none text-accent" size={10} />
          ) : (
            <X className="pointer-events-none select-none" size={10} />
          )}
        </button>
      </div>
    </>
  );
});

export default TerminalTabBarItem;

import { Pin, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";
import type { Terminal } from "@/features/terminal/types/terminal";
import Input from "@/ui/input";
import { UnifiedTab } from "@/ui/unified-tab";
import { cn } from "@/utils/cn";

interface TerminalTabBarItemProps {
  terminal: Terminal;
  displayName: string;
  orientation?: "horizontal" | "vertical";
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
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onRenameBlur: () => void;
}

const TerminalTabBarItem = memo(function TerminalTabBarItem({
  terminal,
  displayName,
  orientation = "horizontal",
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
  isEditing,
  editingName,
  onEditingNameChange,
  onRenameSubmit,
  onRenameCancel,
  onRenameBlur,
}: TerminalTabBarItemProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing || !inputRef.current) return;

    const frameId = requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.select();
    });

    return () => cancelAnimationFrame(frameId);
  }, [isEditing]);

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
          <div
            className={cn(
              "drop-indicator absolute z-20 bg-accent",
              orientation === "vertical"
                ? "top-0 right-1 left-1 h-0.5"
                : "top-1 bottom-1 left-0 w-0.5",
            )}
          />
        </div>
      )}
      <UnifiedTab
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${terminal.name}${terminal.isPinned ? " (pinned)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        className={cn(
          orientation === "vertical"
            ? "w-full max-w-none justify-start pr-5 pl-2"
            : "min-w-[88px] w-fit pr-5 pl-2",
          isEditing ? "pr-2" : undefined,
        )}
        maxWidth={orientation === "vertical" ? undefined : 290}
        onMouseDown={isEditing ? undefined : onMouseDown}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        draggable={!isEditing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={handleAuxClick}
        action={
          !isEditing ? (
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
                "-translate-y-1/2 absolute top-1/2 right-0.5 flex size-4 cursor-pointer select-none items-center justify-center rounded-md text-text-lighter transition-opacity",
                "hover:bg-hover/80 hover:text-text",
                terminal.isPinned || isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              title={terminal.isPinned ? "Unpin terminal" : `Close ${terminal.name}`}
              tabIndex={-1}
              draggable={false}
            >
              {terminal.isPinned ? (
                <Pin
                  className="pointer-events-none select-none fill-current text-accent"
                  size={10}
                />
              ) : (
                <X className="pointer-events-none select-none" size={10} />
              )}
            </button>
          ) : null
        }
      >
        {isEditing ? (
          <Input
            ref={inputRef}
            type="text"
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={onRenameBlur}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                onRenameSubmit();
              } else if (e.key === "Escape") {
                onRenameCancel();
              }
            }}
            variant="ghost"
            className={cn(
              "ui-font h-5 min-w-0 px-0 text-xs",
              orientation === "vertical" ? "text-left" : "text-left",
              isActive ? "text-text" : "text-text-lighter",
            )}
            style={{
              width: `${Math.max(editingName.trim().length || terminal.name.length, 1)}ch`,
              maxWidth: "100%",
            }}
            placeholder="Terminal name"
            spellCheck={false}
          />
        ) : (
          <span
            className={cn(
              "ui-font max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs",
              "text-left",
              isActive ? "text-text" : "text-text-lighter",
            )}
            title={terminal.currentDirectory}
          >
            {displayName}
          </span>
        )}
      </UnifiedTab>
    </>
  );
});

export default TerminalTabBarItem;

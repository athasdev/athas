import { Pin, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";
import type { Terminal } from "@/features/terminal/types/terminal";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { Tab } from "@/ui/tabs";
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
      <Tab
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${terminal.name}${terminal.isPinned ? " (pinned)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        labelPosition={orientation === "vertical" ? "start" : "center"}
        className={cn(
          orientation === "vertical"
            ? "w-full max-w-none justify-start pr-5 pl-2"
            : "min-w-[88px] w-fit pr-5 pl-2",
          isActive ? "bg-hover/80" : undefined,
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
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                if (terminal.isPinned) {
                  handleTabPin(terminal.id);
                } else {
                  handleTabClose(terminal.id);
                }
              }}
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-0.5 cursor-pointer select-none rounded-md text-text-lighter transition-opacity",
                "hover:bg-hover/80 hover:text-text",
                terminal.isPinned || isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover/tab:opacity-100",
              )}
              title={terminal.isPinned ? "Unpin terminal" : `Close ${terminal.name}`}
              tabIndex={-1}
              draggable={false}
            >
              {terminal.isPinned ? (
                <Pin className="pointer-events-none select-none fill-current text-accent" />
              ) : (
                <X className="pointer-events-none select-none" />
              )}
            </Button>
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
              "ui-font ui-text-sm h-5 min-w-0 px-0",
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
              "ui-font ui-text-sm max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
              "text-left",
              isActive ? "text-text" : "text-text-lighter",
            )}
            title={terminal.currentDirectory}
          >
            {displayName}
          </span>
        )}
      </Tab>
    </>
  );
});

export default TerminalTabBarItem;

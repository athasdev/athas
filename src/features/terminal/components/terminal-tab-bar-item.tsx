import { PushPinIcon as Pin, XIcon as X } from "@/ui/icons";
import { memo, useCallback } from "react";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { TabBarTab } from "@/ui/tabs";
import { cn } from "@/utils/cn";

interface TerminalTabBarItemProps {
  terminal: Terminal;
  displayName: string;
  orientation?: "horizontal" | "vertical";
  isActive: boolean;
  isDraggedTab: boolean;
  showDropIndicatorBefore: boolean;
  tabRef: (el: HTMLDivElement | null) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  handleTabClose: (id: string) => void;
  handleTabPin: (id: string) => void;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onRenameSubmit: (value: string) => void;
  onRenameCancel: () => void;
}

const TerminalTabBarItem = memo(function TerminalTabBarItem({
  terminal,
  displayName,
  orientation = "horizontal",
  isActive,
  isDraggedTab,
  showDropIndicatorBefore,
  tabRef,
  onClick,
  onContextMenu,
  onKeyDown,
  handleTabClose,
  handleTabPin,
  isEditing,
  editingName,
  onEditingNameChange,
  onRenameSubmit,
  onRenameCancel,
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
      <TabBarTab
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${terminal.name}${terminal.isPinned ? " (pinned)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        orientation={orientation}
        className={isEditing ? "pr-2" : undefined}
        onClick={isEditing ? undefined : onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onAuxClick={handleAuxClick}
        action={
          !isEditing ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (terminal.isPinned) {
                  handleTabPin(terminal.id);
                } else {
                  handleTabClose(terminal.id);
                }
              }}
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-1 transition-opacity",
                terminal.isPinned || isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover/tab:opacity-100",
              )}
              tooltip={terminal.isPinned ? "Unpin terminal" : `Close ${terminal.name}`}
              shortcut={terminal.isPinned ? undefined : "mod+w"}
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
          <InlineRenameInput
            type="text"
            value={editingName}
            onValueChange={onEditingNameChange}
            onSubmit={onRenameSubmit}
            onCancel={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            tone={isActive ? "default" : "muted"}
            width="content"
            className="min-w-0 max-w-full text-left"
            placeholder="Terminal name"
            aria-label={`Rename ${displayName}`}
            spellCheck={false}
          />
        ) : (
          <span
            className={cn(
              "font-sans ui-text-sm max-w-full select-none overflow-hidden text-ellipsis whitespace-nowrap",
              "text-left",
              isActive ? "text-text" : "text-text-lighter",
            )}
            title={terminal.currentDirectory}
          >
            {displayName}
          </span>
        )}
      </TabBarTab>
    </>
  );
});

export default TerminalTabBarItem;

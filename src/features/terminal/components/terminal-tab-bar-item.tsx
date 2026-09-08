import { ColumnsIcon, PauseIcon, PinIcon, WarningCircleIcon, XIcon } from "@/ui/icons";
import { memo, useCallback } from "react";
import type {
  Terminal,
  TerminalCommandSummary,
  TerminalProgress,
} from "@/features/terminal/types/terminal.types";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { ProgressCircle } from "@/ui/progress";
import { Spinner } from "@/ui/spinner";
import { TabItem } from "@/ui/tab-bar";
import { cn } from "@/utils/cn";

interface TerminalTabBarItemProps {
  terminal: Terminal;
  displayName: string;
  progress?: TerminalProgress;
  lastCommand?: TerminalCommandSummary;
  isSplit?: boolean;
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

function TerminalProgressIndicator({ progress }: { progress: TerminalProgress }) {
  const label = `${Math.round(progress.value)}% complete`;

  if (progress.state === 2) {
    return (
      <WarningCircleIcon className="shrink-0 text-destructive" aria-label={`${label}, failed`} />
    );
  }
  if (progress.state === 3) {
    return <Spinner label="Working" compact className="shrink-0" />;
  }
  if (progress.state === 4) {
    return <PauseIcon className="shrink-0 text-warning" aria-label={`${label}, paused`} />;
  }
  return (
    <ProgressCircle
      value={progress.value}
      className="size-3.5 shrink-0"
      role="img"
      aria-label={label}
    />
  );
}

function TerminalCommandBadge({ command }: { command: TerminalCommandSummary }) {
  const failed = command.status === "failure";
  return (
    <span
      role="img"
      aria-label={failed ? "Last command failed" : "Last command finished"}
      className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-success")}
    />
  );
}

const TerminalTabBarItem = memo(function TerminalTabBarItem({
  terminal,
  displayName,
  progress,
  lastCommand,
  isSplit = false,
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
          <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-primary" />
        </div>
      )}
      <TabItem
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${terminal.name}${terminal.isPinned ? " (pinned)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        onClick={isEditing ? undefined : onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onAuxClick={handleAuxClick}
        action={
          !isEditing ? (
            <span
              className={cn(
                "inline-flex -translate-y-1/2 absolute top-1/2 right-1 transition-opacity focus-within:opacity-100",
                terminal.isPinned || isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <Button
                type="button"
                iconOnly
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (terminal.isPinned) {
                    handleTabPin(terminal.id);
                  } else {
                    handleTabClose(terminal.id);
                  }
                }}
                tooltip={terminal.isPinned ? "Unpin terminal" : `Close ${terminal.name}`}
                commandId={terminal.isPinned ? undefined : "terminal.close"}
                tabIndex={-1}
                draggable={false}
              >
                {terminal.isPinned ? (
                  <PinIcon className="pointer-events-none select-none fill-current text-primary" />
                ) : (
                  <XIcon className="pointer-events-none select-none" />
                )}
              </Button>
            </span>
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
            placeholder="Terminal name"
            aria-label={`Rename ${displayName}`}
            spellCheck={false}
          />
        ) : (
          <>
            {progress ? <TerminalProgressIndicator progress={progress} /> : null}
            {!progress && lastCommand && !isActive ? (
              <TerminalCommandBadge command={lastCommand} />
            ) : null}
            {isSplit ? (
              <ColumnsIcon
                className="size-3 shrink-0 text-subtle-foreground"
                aria-label="Part of a split group"
              />
            ) : null}
            <span
              className={cn(
                "font-sans ui-text-chrome max-w-full select-none overflow-hidden text-ellipsis whitespace-nowrap",
                "text-left",
                isActive ? "text-foreground" : "text-subtle-foreground",
              )}
              title={
                terminal.currentDirectory
                  ? `${displayName} — ${terminal.currentDirectory}`
                  : displayName
              }
            >
              {displayName}
            </span>
          </>
        )}
      </TabItem>
    </>
  );
});

export default TerminalTabBarItem;

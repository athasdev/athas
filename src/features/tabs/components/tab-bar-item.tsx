import { Database, Package, Pin, X } from "lucide-react";
import { memo, useCallback } from "react";
import { FileIcon } from "@/features/file-explorer/components/file-icon";
import type { Buffer } from "@/features/tabs/types/buffer";
import { cn } from "@/utils/cn";

interface TabBarItemProps {
  buffer: Buffer;
  displayName: string;
  index: number;
  isActive: boolean;
  isDraggedTab: boolean;
  showDropIndicatorBefore: boolean;
  tabRef: (el: HTMLDivElement | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  handleTabClose: (id: string) => void;
  handleTabPin: (id: string) => void;
}

const TabBarItem = memo(function TabBarItem({
  buffer,
  displayName,
  isActive,
  isDraggedTab,
  showDropIndicatorBefore,
  tabRef,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onKeyDown,
  handleTabClose,
  handleTabPin,
}: TabBarItemProps) {
  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle middle click here
      if (e.button !== 1) return;

      handleTabClose(buffer.id);
    },
    [handleTabClose, buffer.id],
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
        aria-label={`${buffer.name}${buffer.isDirty ? " (unsaved)" : ""}${buffer.isPinned ? " (pinned)" : ""}${buffer.isPreview ? " (preview)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        className={cn(
          "group relative flex shrink-0 cursor-pointer select-none items-center gap-1 whitespace-nowrap border-border border-r px-1.5 py-0.5 transition-[transform,opacity] duration-200 ease-[ease]",
          isActive ? "bg-primary-bg" : "bg-secondary-bg",
          buffer.isPinned ? "border-l-2 border-l-accent" : "",
          isDraggedTab ? "opacity-30" : "opacity-100",
        )}
        style={{ minWidth: 100, maxWidth: 300 }}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={handleAuxClick}
      >
        {isActive && <div className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
        <div className="grid size-3 max-h-3 max-w-3 shrink-0 place-content-center py-3">
          {buffer.path === "extensions://marketplace" ? (
            <Package size={12} className="text-accent" />
          ) : buffer.isSQLite ? (
            <Database size={12} className="text-text-lighter" />
          ) : (
            <FileIcon
              fileName={buffer.name}
              isDir={false}
              className="text-text-lighter"
              size={12}
            />
          )}
        </div>
        <span
          className={cn(
            "ui-font flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs",
            isActive ? "text-text" : "text-text-light",
            buffer.isPreview && "italic",
          )}
          title={buffer.path}
        >
          {displayName}
        </span>
        {buffer.isDirty && (
          <div
            className="size-2 shrink-0 rounded-full bg-accent"
            title="Unsaved changes"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
        {/* Pin button (replaces close button when pinned) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (buffer.isPinned) {
              handleTabPin(buffer.id);
            } else {
              handleTabClose(buffer.id);
            }
          }}
          className={cn(
            "-translate-y-1/2 absolute top-1/2 right-1 flex size-4 cursor-pointer select-none items-center justify-center rounded transition-opacity",
            "bg-primary-bg text-text-lighter",
            "hover:bg-hover hover:text-text",
            buffer.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title={buffer.isPinned ? "Unpin tab" : `Close ${buffer.name}`}
          tabIndex={-1}
          draggable={false}
        >
          {buffer.isPinned ? (
            <Pin className="pointer-events-none select-none text-accent" size={10} />
          ) : (
            <X className="pointer-events-none select-none" size={10} />
          )}
        </button>
      </div>
    </>
  );
});

export default TabBarItem;

import { Database, Package, Pin, X } from "lucide-react";
import { memo, useCallback } from "react";
import FileIcon from "@/file-explorer/views/file.icon";
import type { Buffer } from "@/types/buffer";
import { cn } from "@/utils/cn";

interface TabBarItemProps {
  buffer: Buffer;
  index: number;
  isActive: boolean;
  isDraggedTab: boolean;
  showDropIndicatorBefore: boolean;
  tabRef: (el: HTMLDivElement | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  handleTabClose: (id: string) => void;
}

const TabBarItem = memo(function TabBarItem({
  buffer,
  isActive,
  isDraggedTab,
  showDropIndicatorBefore,
  tabRef,
  onMouseDown,
  onContextMenu,
  onDragStart,
  onDragEnd,
  handleTabClose,
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
        className={cn(
          "tab-bar-item group relative flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-2 py-1",
          isActive ? "bg-primary-bg" : "bg-secondary-bg",
          buffer.isPinned ? "border-l-2 border-l-blue-500" : "",
          isDraggedTab ? "opacity-30" : "opacity-100",
        )}
        style={{ minWidth: 120, maxWidth: 400 }}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={handleAuxClick}
      >
        {isActive && <div className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
        <div className="grid size-3 max-h-3 max-w-3 shrink-0 place-content-center py-3">
          {buffer.path === "extensions://marketplace" ? (
            <Package size={12} className="text-blue-500" />
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
        {buffer.isPinned && <Pin size={8} className="flex-shrink-0 text-blue-500" />}
        <span
          className={cn(
            "flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs",
            isActive ? "text-text" : "text-text-light",
          )}
          title={buffer.path}
        >
          {buffer.name}
          {buffer.isDirty && <span className="ml-1 text-text-lighter">•</span>}
        </span>
        {!buffer.isPinned && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleTabClose(buffer.id);
            }}
            className={cn(
              "flex-shrink-0 cursor-pointer select-none rounded p-0.5",
              "text-text-lighter transition-all duration-150",
              "hover:bg-hover hover:text-text hover:opacity-100 group-hover:opacity-100",
              {
                "opacity-100": isActive,
                "opacity-0": !isActive,
              },
            )}
            title={`Close ${buffer.name}`}
            tabIndex={-1}
            draggable={false}
          >
            <X className="pointer-events-none select-none" size={12} />
          </button>
        )}
      </div>
    </>
  );
});

export default TabBarItem;

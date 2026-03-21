import { Database, Globe, Package, Pin, Sparkles, Terminal, X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { Tab } from "@/ui/tabs";
import { cn } from "@/utils/cn";

interface TabBarItemProps {
  buffer: PaneContent;
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
  const [faviconError, setFaviconError] = useState(false);

  // Reset favicon error when favicon URL changes
  useEffect(() => {
    setFaviconError(false);
  }, [buffer.type === "webViewer" ? buffer.favicon : undefined]);

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
      <Tab
        ref={tabRef}
        role="tab"
        aria-selected={isActive}
        aria-label={`${buffer.name}${buffer.type === "editor" && buffer.isDirty ? " (unsaved)" : ""}${buffer.isPinned ? " (pinned)" : ""}${buffer.isPreview ? " (preview)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={handleAuxClick}
        action={
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
              "-translate-y-1/2 absolute top-1/2 right-0.5 flex size-4 cursor-pointer select-none items-center justify-center rounded-md text-text-lighter transition-opacity",
              "hover:bg-hover/80 hover:text-text",
              buffer.isPinned || isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            title={buffer.isPinned ? "Unpin tab" : `Close ${buffer.name}`}
            tabIndex={-1}
            draggable={false}
          >
            {buffer.isPinned ? (
              <Pin className="pointer-events-none select-none fill-current text-accent" size={10} />
            ) : (
              <X className="pointer-events-none select-none" size={10} />
            )}
          </button>
        }
      >
        <div className="grid size-3 shrink-0 place-content-center">
          {buffer.path === "extensions://marketplace" ? (
            <Package size={12} className="text-text-lighter" />
          ) : buffer.type === "terminal" ? (
            <Terminal size={12} className="text-text-lighter" />
          ) : buffer.type === "agent" ? (
            <Sparkles size={12} className="text-text-lighter" />
          ) : buffer.type === "webViewer" ? (
            buffer.favicon && !faviconError ? (
              <img
                src={buffer.favicon}
                alt=""
                className="size-3 object-contain"
                onError={() => setFaviconError(true)}
              />
            ) : (
              <Globe size={12} className="text-text-lighter" />
            )
          ) : buffer.type === "database" ? (
            <Database size={12} className="text-text-lighter" />
          ) : (
            <FileExplorerIcon
              fileName={buffer.name}
              isDir={false}
              className="text-text-lighter"
              size={12}
            />
          )}
        </div>
        <span
          className={cn(
            "ui-font max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs",
            isActive ? "text-text" : "text-text-lighter",
            buffer.isPreview && "italic",
          )}
          title={buffer.path}
        >
          {displayName}
        </span>
        {buffer.type === "editor" && buffer.isDirty && (
          <div
            className="size-2 shrink-0 rounded-full bg-accent"
            title="Unsaved changes"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
      </Tab>
    </>
  );
});

export default TabBarItem;

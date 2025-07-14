import { Database, Package, Pin, PinOff, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Buffer } from "../types/buffer";
import { getShortcutText } from "../utils/platform";
import FileIcon from "./file-icon";

interface TabBarProps {
  buffers: Buffer[];
  activeBufferId: string | null;
  onTabClick: (bufferId: string) => void;
  onTabClose: (bufferId: string, event: React.MouseEvent) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTabPin?: (bufferId: string) => void;
  onCloseOtherTabs?: (bufferId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTabsToRight?: (bufferId: string) => void;
  onTabDragStart?: (bufferId: string, paneId?: string) => void;
  onTabDragEnd?: () => void;
  paneId?: string; // For split view panes
  maxOpenTabs: number; // Optional prop to limit open tabs
  externallyModifiedPaths?: Set<string>; // Paths that have been modified externally
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  buffer: Buffer | null;
  onClose: () => void;
  onPin: (bufferId: string) => void;
  onCloseTab: (bufferId: string) => void;
  onCloseOthers: (bufferId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (bufferId: string) => void;
}

const ContextMenu = ({
  isOpen,
  position,
  buffer,
  onClose,
  onPin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
}: ContextMenuProps) => {
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

  if (!isOpen || !buffer) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-max min-w-[120px] rounded border border-border bg-primary-bg py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:shadow-xl"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover dark:text-gray-200 dark:hover:bg-gray-700"
        onClick={() => {
          onPin(buffer.id);
          onClose();
        }}
      >
        {buffer.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {buffer.isPinned ? "Unpin Tab" : "Pin Tab"}
      </button>

      <div className="my-1 border-border border-t dark:border-gray-600" />
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover dark:text-gray-200 dark:hover:bg-gray-700"
        onClick={() => {
          onCloseTab(buffer.id);
          onClose();
        }}
      >
        <span>Close</span>
        <span className="font-mono text-[10px] text-text-lighter opacity-60">
          {getShortcutText("w", ["cmd"])}
        </span>
      </button>
      <button
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover dark:text-gray-200 dark:hover:bg-gray-700"
        onClick={() => {
          onCloseOthers(buffer.id);
          onClose();
        }}
      >
        Close Others
      </button>
      <button
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover dark:text-gray-200 dark:hover:bg-gray-700"
        onClick={() => {
          onCloseToRight(buffer.id);
          onClose();
        }}
      >
        Close to Right
      </button>
      <button
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-hover dark:text-gray-200 dark:hover:bg-gray-700"
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

const TabBar = ({
  buffers,
  activeBufferId,
  onTabClick,
  onTabClose,
  onTabReorder,
  onTabPin,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onTabDragStart,
  onTabDragEnd,
  paneId,
  maxOpenTabs,
  externallyModifiedPaths = new Set(),
}: TabBarProps) => {
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
    buffer: Buffer | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Sort buffers: pinned tabs first, then regular tabs
  const sortedBuffers = useMemo(() => {
    return [...buffers].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });
  }, [buffers]);

  useEffect(() => {
    if (maxOpenTabs > 0 && buffers.length > maxOpenTabs && onTabClose) {
      // Filter out pinned and active tabs
      const closableBuffers = buffers.filter(b => !b.isPinned && b.id !== activeBufferId);

      // Close oldest tabs until under limit (oldest = lowest index)
      let tabsToClose = buffers.length - maxOpenTabs;
      for (let i = 0; i < closableBuffers.length && tabsToClose > 0; i++) {
        onTabClose(closableBuffers[i].id, new MouseEvent("click") as any);
        tabsToClose--;
      }
    }
  }, [buffers, maxOpenTabs, activeBufferId, onTabClose]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const activeIndex = sortedBuffers.findIndex(buffer => buffer.id === activeBufferId);
    if (activeIndex !== -1 && tabRefs.current[activeIndex] && tabBarRef.current) {
      const activeTab = tabRefs.current[activeIndex];
      const container = tabBarRef.current;

      if (activeTab) {
        const tabRect = activeTab.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Check if tab is out of view
        if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
          activeTab.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
        }
      }
    }
  }, [activeBufferId, sortedBuffers]);

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
      // Notify parent about drag start
      const draggedBuffer = sortedBuffers[draggedIndex];
      if (onTabDragStart && draggedBuffer) {
        onTabDragStart(draggedBuffer.id, paneId);
      }
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
        const tabElements = Array.from(tabBarRef.current.children) as HTMLElement[];

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
          const movedBuffer = sortedBuffers[draggedIndex];
          if (movedBuffer) {
            onTabClick(movedBuffer.id);
          }
        }
      }
      // Notify parent about drag end
      if (onTabDragEnd) {
        onTabDragEnd();
      }
    }

    setIsDragging(false);
    setDraggedIndex(null);
    setDropTarget(null);
    setDragStartPosition(null);
    setDragCurrentPosition(null);
    setIsDraggedOutside(false);
  };

  // Add drag data to enable cross-pane tab movement
  const handleDragStart = (e: React.DragEvent, index: number) => {
    const buffer = sortedBuffers[index];
    if (!buffer) return;

    e.dataTransfer.setData(
      "application/tab-data",
      JSON.stringify({
        bufferId: buffer.id,
        paneId: paneId,
        bufferData: buffer,
      }),
    );
    e.dataTransfer.effectAllowed = "move";

    // Create drag image
    const dragImage = document.createElement("div");
    dragImage.className =
      "bg-primary-bg border border-border rounded px-2 py-1 text-xs font-mono shadow-lg";
    dragImage.textContent = buffer.name;
    dragImage.style.position = "absolute";
    dragImage.style.top = "-1000px";
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggedIndex(null);
    setDropTarget(null);
    setDragStartPosition(null);
    setDragCurrentPosition(null);
    setIsDraggedOutside(false);
    if (onTabDragEnd) {
      onTabDragEnd();
    }
  };

  const handleContextMenu = (e: React.MouseEvent, buffer: Buffer) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      buffer,
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });
  };

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

  // Early return after all hooks are declared
  if (buffers.length === 0) {
    return null;
  }

  return (
    <>
      <div className="relative">
        <div
          ref={tabBarRef}
          className="scrollbar-hidden flex overflow-x-auto border-border border-b bg-secondary-bg"
        >
          {sortedBuffers.map((buffer, index) => {
            const isActive = buffer.id === activeBufferId;
            const isExternallyModified = externallyModifiedPaths.has(buffer.path);
            // Drop indicator should be shown before the tab at dropTarget
            const showDropIndicator =
              dropTarget === index && draggedIndex !== null && !isDraggedOutside;

            return (
              <React.Fragment key={buffer.id}>
                {/* Drop indicator before tab */}
                {showDropIndicator && (
                  <div className="relative flex items-center">
                    <div
                      className="absolute top-0 bottom-0 z-10 h-full w-0.5 bg-accent"
                      style={{ height: "100%" }}
                    />
                  </div>
                )}
                <div
                  ref={el => {
                    tabRefs.current[index] = el;
                  }}
                  draggable={true}
                  onDragStart={e => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`group relative flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-border border-r px-3 py-1.5 transition-colors duration-150 hover:bg-hover ${
                    isActive ? "border-b-2 border-b-accent bg-primary-bg" : "bg-secondary-bg"
                  } ${buffer.isPinned ? "border-l-2 border-l-blue-500" : ""} `}
                  style={{ minWidth: "120px", maxWidth: "400px" }}
                  onMouseDown={e => handleMouseDown(e, index)}
                  onClick={() => {
                    if (!isDragging) {
                      onTabClick(buffer.id);
                    }
                  }}
                  onContextMenu={e => handleContextMenu(e, buffer)}
                >
                  {/* File Icon */}
                  <div className="flex-shrink-0">
                    {buffer.path === "extensions://language-servers" ? (
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

                  {/* Pin indicator */}
                  {buffer.isPinned && <Pin size={8} className="flex-shrink-0 text-blue-500" />}

                  {/* File Name */}
                  <span
                    className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs ${isActive ? "text-text" : "text-text-light"} `}
                    title={buffer.path}
                  >
                    {buffer.name}
                    {buffer.isDirty && <span className="ml-1 text-text-lighter">•</span>}
                    {isExternallyModified && !buffer.isDirty && (
                      <span className="ml-1 text-yellow-400" title="Modified externally">
                        ⚠
                      </span>
                    )}
                  </span>

                  {/* Close Button */}
                  {!buffer.isPinned && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onTabClose(buffer.id, e);
                      }}
                      className={`flex-shrink-0 cursor-pointer rounded p-0.5 opacity-0 transition-all duration-150 hover:bg-hover group-hover:opacity-100 ${isActive ? "text-text opacity-70" : "text-text-lighter"}hover:text-text hover:opacity-100 `}
                      title={`Close ${buffer.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </React.Fragment>
            );
          })}
          {/* Drop indicator after the last tab */}
          {dropTarget === sortedBuffers.length && draggedIndex !== null && !isDraggedOutside && (
            <div className="relative flex items-center">
              <div
                className="absolute top-0 bottom-0 z-10 w-0.5 bg-accent"
                style={{ height: "100%" }}
              />
            </div>
          )}
        </div>
        {/* Floating tab name while dragging */}
        {isDragging && draggedIndex !== null && dragCurrentPosition && (
          <div
            ref={el => {
              if (el && window) {
                // Center the floating tab on the cursor
                const rect = el.getBoundingClientRect();
                el.style.left = `${dragCurrentPosition.x - rect.width / 2}px`;
                el.style.top = `${dragCurrentPosition.y - rect.height / 2}px`;
              }
            }}
            className="fixed z-50 flex cursor-pointer items-center gap-1.5 rounded border border-border bg-primary-bg px-2 py-1.5 font-mono text-xs shadow-lg"
            style={{
              opacity: 0.95,
              minWidth: 60,
              maxWidth: 220,
              whiteSpace: "nowrap",
              color: "var(--text-color)",
            }}
          >
            {/* File Icon */}
            <span className="flex-shrink-0">
              {sortedBuffers[draggedIndex].path === "extensions://language-servers" ? (
                <Package size={12} className="text-blue-500" />
              ) : sortedBuffers[draggedIndex].isSQLite ? (
                <Database size={12} className="text-text-lighter" />
              ) : (
                <FileIcon
                  fileName={sortedBuffers[draggedIndex].name}
                  isDir={false}
                  className="text-text-lighter"
                  size={12}
                />
              )}
            </span>
            {/* Pin indicator */}
            {sortedBuffers[draggedIndex].isPinned && (
              <Pin size={8} className="flex-shrink-0 text-blue-500" />
            )}
            <span className="truncate">
              {sortedBuffers[draggedIndex].name}
              {sortedBuffers[draggedIndex].isDirty && (
                <span className="ml-1 text-text-lighter">•</span>
              )}
            </span>
          </div>
        )}
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        buffer={contextMenu.buffer}
        onClose={closeContextMenu}
        onPin={onTabPin || (() => {})}
        onCloseTab={bufferId => {
          const buffer = buffers.find(b => b.id === bufferId);
          if (buffer) {
            onTabClose(bufferId, {} as React.MouseEvent);
          }
        }}
        onCloseOthers={onCloseOtherTabs || (() => {})}
        onCloseAll={onCloseAllTabs || (() => {})}
        onCloseToRight={onCloseTabsToRight || (() => {})}
      />
    </>
  );
};

export default TabBar;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import type { Buffer } from "@/types/buffer";
import TabBarItem from "./tab-bar-item";
import TabContextMenu from "./tab-context-menu";
import TabDragPreview from "./tab-drag-preview";

interface TabBarProps {
  paneId?: string; // For split view panes (future feature)
}

const DRAG_THRESHOLD = 5;

interface TabPosition {
  index: number;
  left: number;
  right: number;
  width: number;
  center: number;
}

const TabBar = ({ paneId }: TabBarProps) => {
  // Get everything from stores
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const {
    handleTabClick,
    handleTabClose,
    handleTabPin,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleCloseTabsToRight,
    reorderBuffers,
  } = useBufferStore.use.actions();
  const { settings } = useSettingsStore();
  const { updateActivePath } = useSidebarStore();

  // Drag state
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    draggedIndex: number | null;
    dropTargetIndex: number | null;
    startPosition: { x: number; y: number } | null;
    currentPosition: { x: number; y: number } | null;
    tabPositions: TabPosition[];
    lastValidDropTarget: number | null;
    dragDirection: "left" | "right" | null;
  }>({
    isDragging: false,
    draggedIndex: null,
    dropTargetIndex: null,
    startPosition: null,
    currentPosition: null,
    tabPositions: [],
    lastValidDropTarget: null,
    dragDirection: null,
  });

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    buffer: Buffer | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStateRef = useRef(dragState);
  const { clearPositionCache } = useEditorCursorStore.getState().actions;

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const sortedBuffers = useMemo(() => {
    return [...buffers].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });
  }, [buffers]);

  useEffect(() => {
    if (settings.maxOpenTabs > 0 && buffers.length > settings.maxOpenTabs && handleTabClose) {
      const closableBuffers = buffers.filter((b) => !b.isPinned && b.id !== activeBufferId);

      let tabsToClose = buffers.length - settings.maxOpenTabs;
      for (let i = 0; i < closableBuffers.length && tabsToClose > 0; i++) {
        handleTabClose(closableBuffers[i].id);
        tabsToClose--;
      }
    }
  }, [buffers, settings.maxOpenTabs, activeBufferId, handleTabClose]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const activeIndex = sortedBuffers.findIndex((buffer) => buffer.id === activeBufferId);
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

  const cacheTabPositions = useCallback((): TabPosition[] => {
    if (!tabBarRef.current) return [];
    const containerRect = tabBarRef.current.getBoundingClientRect();
    const positions: TabPosition[] = [];
    tabRefs.current.forEach((tab, index) => {
      if (tab) {
        const rect = tab.getBoundingClientRect();
        const left = rect.left - containerRect.left;
        const right = rect.right - containerRect.left;
        positions.push({
          index,
          left,
          right,
          width: rect.width,
          center: left + rect.width / 2,
        });
      }
    });
    return positions;
  }, []);

  const calculateDropTarget = (
    mouseX: number,
    currentDropTarget: number | null,
    draggedIndex: number,
    tabPositions: TabPosition[],
    dragDirection: "left" | "right" | null,
  ): { dropTarget: number; direction: "left" | "right" | null } => {
    if (!tabBarRef.current || tabPositions.length === 0) {
      return {
        dropTarget: currentDropTarget ?? draggedIndex,
        direction: dragDirection,
      };
    }

    const containerRect = tabBarRef.current.getBoundingClientRect();
    const relativeX = mouseX - containerRect.left;

    let newDropTarget = draggedIndex;

    // before first tab
    if (relativeX < tabPositions[0]?.left) {
      newDropTarget = 0;
    }
    // after last tab
    else if (relativeX > tabPositions[tabPositions.length - 1]?.right) {
      newDropTarget = tabPositions.length;
    }
    // we over yo lets do some magic
    else {
      for (let i = 0; i < tabPositions.length; i++) {
        const pos = tabPositions[i];

        if (relativeX >= pos.left && relativeX <= pos.right) {
          const relativePositionInTab = (relativeX - pos.left) / pos.width;
          if (currentDropTarget !== null && Math.abs(currentDropTarget - i) <= 1) {
            const threshold = 0.25;

            if (relativePositionInTab < 0.5 - threshold) {
              newDropTarget = i;
            } else if (relativePositionInTab > 0.5 + threshold) {
              newDropTarget = i + 1;
            } else {
              newDropTarget = currentDropTarget;
            }
          } else {
            newDropTarget = relativePositionInTab < 0.5 ? i : i + 1;
          }
          break;
        }
      }
    }

    return {
      dropTarget: newDropTarget,
      direction: relativeX > (tabPositions[draggedIndex]?.center ?? 0) ? "right" : "left",
    };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      setDragState((prev) => {
        if (prev.draggedIndex === null || !prev.startPosition) return prev;
        const currentPosition = { x: e.clientX, y: e.clientY };
        const distance = Math.sqrt(
          (currentPosition.x - prev.startPosition.x) ** 2 +
            (currentPosition.y - prev.startPosition.y) ** 2,
        );
        if (!prev.isDragging && distance > DRAG_THRESHOLD) {
          const tabPositions = cacheTabPositions();
          if (
            prev.isDragging &&
            prev.currentPosition?.x === currentPosition.x &&
            prev.currentPosition?.y === currentPosition.y
          ) {
            return prev; // No change
          }
          return {
            ...prev,
            isDragging: true,
            currentPosition,
            tabPositions,
            dropTargetIndex: prev.draggedIndex,
            lastValidDropTarget: prev.draggedIndex,
          };
        }
        if (prev.isDragging) {
          const { dropTarget, direction } = calculateDropTarget(
            e.clientX,
            prev.dropTargetIndex,
            prev.draggedIndex,
            prev.tabPositions,
            prev.dragDirection,
          );
          if (
            prev.currentPosition?.x === currentPosition.x &&
            prev.currentPosition?.y === currentPosition.y &&
            prev.dropTargetIndex === dropTarget &&
            prev.dragDirection === direction
          ) {
            return prev; // No change
          }
          return {
            ...prev,
            currentPosition,
            dropTargetIndex: dropTarget,
            lastValidDropTarget: dropTarget,
            dragDirection: direction,
          };
        }
        if (
          prev.currentPosition?.x === currentPosition.x &&
          prev.currentPosition?.y === currentPosition.y
        ) {
          return prev; // No change
        }
        return { ...prev, currentPosition };
      });
    },
    [cacheTabPositions],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
        return;
      }
      handleTabClick(sortedBuffers[index].id);
      updateActivePath(sortedBuffers[index].path);
      e.preventDefault();
      setDragState({
        isDragging: false,
        draggedIndex: index,
        dropTargetIndex: null,
        startPosition: { x: e.clientX, y: e.clientY },
        currentPosition: { x: e.clientX, y: e.clientY },
        tabPositions: [],
        lastValidDropTarget: null,
        dragDirection: null,
      });
    },
    [handleTabClick, sortedBuffers],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, buffer: Buffer) => {
    e.preventDefault();

    // Get the tab element that was right-clicked
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    // Position the menu relative to the tab element
    // This approach is zoom-independent because getBoundingClientRect()
    // already accounts for zoom scaling
    const x = rect.left + rect.width * 0.5; // Center horizontally on the tab
    const y = rect.bottom + 4; // Position just below the tab with small offset

    setContextMenu({
      isOpen: true,
      position: { x, y },
      buffer,
    });
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
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
    },
    [sortedBuffers, paneId],
  );

  const handleDragEnd = useCallback(() => {}, []);

  const closeContextMenu = () => {
    console.log("????");

    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });
  };

  useEffect(() => {
    if (dragState.draggedIndex === null) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleMouseMove(e);
    };

    const handleGlobalMouseUp = () => {
      const currentState = dragStateRef.current;

      if (
        currentState.isDragging &&
        currentState.draggedIndex !== null &&
        currentState.dropTargetIndex !== null &&
        reorderBuffers
      ) {
        if (currentState.dropTargetIndex !== currentState.draggedIndex) {
          let adjustedDropTarget = currentState.dropTargetIndex;
          if (currentState.draggedIndex < currentState.dropTargetIndex) {
            adjustedDropTarget = currentState.dropTargetIndex - 1;
          }

          if (adjustedDropTarget !== currentState.draggedIndex) {
            reorderBuffers(currentState.draggedIndex, adjustedDropTarget);

            const movedBuffer = sortedBuffers[currentState.draggedIndex];
            if (movedBuffer) {
              handleTabClick(movedBuffer.id);
            }
          }
        }
      }

      setDragState({
        isDragging: false,
        draggedIndex: null,
        dropTargetIndex: null,
        startPosition: null,
        currentPosition: null,
        tabPositions: [],
        lastValidDropTarget: null,
        dragDirection: null,
      });
    };

    document.addEventListener("mousemove", handleGlobalMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [dragState.draggedIndex, reorderBuffers, handleTabClick, sortedBuffers, handleMouseMove]);

  useEffect(() => {
    tabRefs.current = tabRefs.current.slice(0, sortedBuffers.length);
  }, [sortedBuffers.length]);

  const MemoizedTabContextMenu = useMemo(() => TabContextMenu, []);

  if (buffers.length === 0) {
    return null;
  }

  const { isDragging, draggedIndex, dropTargetIndex, currentPosition } = dragState;

  return (
    <>
      <div className="relative">
        <div ref={tabBarRef} className="scrollbar-hidden flex overflow-x-auto bg-secondary-bg">
          {sortedBuffers.map((buffer, index) => {
            const isActive = buffer.id === activeBufferId;
            const isDraggedTab = isDragging && draggedIndex === index;
            const showDropIndicatorBefore =
              isDragging && dropTargetIndex === index && draggedIndex !== index;
            return (
              <TabBarItem
                key={buffer.id}
                buffer={buffer}
                index={index}
                isActive={isActive}
                isDraggedTab={isDraggedTab}
                showDropIndicatorBefore={showDropIndicatorBefore}
                tabRef={(el) => {
                  tabRefs.current[index] = el;
                }}
                onMouseDown={(e) => handleMouseDown(e, index)}
                onContextMenu={(e) => handleContextMenu(e, buffer)}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                handleTabClose={(id) => {
                  handleTabClose(id);
                  // Clear cached position for this buffer
                  clearPositionCache(id);
                }}
              />
            );
          })}

          {isDragging && dropTargetIndex === sortedBuffers.length && (
            <div className="relative">
              <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
            </div>
          )}
        </div>

        {isDragging &&
          draggedIndex !== null &&
          currentPosition &&
          createPortal(
            <TabDragPreview
              x={currentPosition.x}
              y={currentPosition.y}
              buffer={sortedBuffers[draggedIndex]}
            />,
            document.body,
          )}
      </div>

      <MemoizedTabContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        buffer={contextMenu.buffer}
        onClose={closeContextMenu}
        onPin={handleTabPin || (() => {})}
        onCloseTab={(bufferId) => {
          const buffer = buffers.find((b) => b.id === bufferId);
          if (buffer) {
            handleTabClose(bufferId);
          }
        }}
        onCloseOthers={handleCloseOtherTabs || (() => {})}
        onCloseAll={handleCloseAllTabs || (() => {})}
        onCloseToRight={handleCloseTabsToRight || (() => {})}
        onCopyPath={async (path: string) => {
          try {
            await navigator.clipboard.writeText(path);
          } catch (error) {
            console.error("Failed to copy path:", error);
          }
        }}
        onReload={(bufferId: string) => {
          // Reload the buffer by closing and reopening it
          const buffer = buffers.find((b) => b.id === bufferId);
          if (buffer && buffer.path !== "extensions://marketplace") {
            const { closeBuffer, openBuffer } = useBufferStore.getState().actions;
            closeBuffer(bufferId);
            // Re-read the file and open it again
            setTimeout(async () => {
              try {
                // This would need to use the file reading utility
                // For now, just reopen with current content
                openBuffer(
                  buffer.path,
                  buffer.name,
                  buffer.content,
                  buffer.isImage,
                  buffer.isSQLite,
                  buffer.isDiff,
                );
              } catch (error) {
                console.error("Failed to reload buffer:", error);
              }
            }, 100);
          }
        }}
        onRevealInFinder={(path: string) => {
          // Platform-specific reveal in finder/explorer
          if (window.electron) {
            window.electron.shell.showItemInFolder(path);
          } else {
          }
        }}
      />
    </>
  );
};

export default TabBar;

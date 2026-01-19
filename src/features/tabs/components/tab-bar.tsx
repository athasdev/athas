import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import type { Buffer } from "@/features/tabs/types/buffer";
import { useAppStore } from "@/stores/app-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import UnsavedChangesDialog from "@/ui/unsaved-changes-dialog";
import { calculateDisplayNames } from "../utils/path-shortener";
import { NewTabMenu } from "./new-tab-menu";
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
  const pendingClose = useBufferStore.use.pendingClose();
  const {
    handleTabClick,
    handleTabClose,
    handleTabPin,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleCloseTabsToRight,
    reorderBuffers,
    confirmCloseWithoutSaving,
    cancelPendingClose,
    convertPreviewToDefinite,
  } = useBufferStore.use.actions();
  const { handleSave } = useAppStore.use.actions();
  const { settings } = useSettingsStore();
  const { updateActivePath } = useSidebarStore();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.() || undefined;

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

  const [srAnnouncement, setSrAnnouncement] = useState<string>("");

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStateRef = useRef(dragState);
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();
  const { clearPositionCache } = useEditorStateStore.getState().actions;

  // Handle horizontal scrolling with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const container = tabBarRef.current;
    if (!container) return;

    // Only handle horizontal scrolling when scrolling vertically over the tab bar
    if (e.deltaY !== 0) {
      e.preventDefault();
      // Multiply by 5 for smoother, less friction scrolling
      container.scrollLeft += e.deltaY;
    }
  }, []);

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

  // Calculate display names for tabs with minimal distinguishing paths
  const displayNames = useMemo(() => {
    return calculateDisplayNames(buffers, rootFolderPath);
  }, [buffers, rootFolderPath]);

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
      const buffer = sortedBuffers[index];
      handleTabClick(buffer.id);
      updateActivePath(buffer.path);

      // Announce tab switch to screen readers
      setSrAnnouncement(`Switched to ${buffer.name}${buffer.isDirty ? ", unsaved changes" : ""}`);

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
    [handleTabClick, sortedBuffers, updateActivePath],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      const buffer = sortedBuffers[index];
      // Convert preview tab to definite on double-click
      if (buffer.isPreview) {
        convertPreviewToDefinite(buffer.id);
      }
    },
    [sortedBuffers, convertPreviewToDefinite],
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
        "bg-primary-bg border border-border rounded px-2 py-1 text-xs ui-font shadow-lg";
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

  const handleCopyPath = useCallback(
    async (path: string) => {
      await writeText(path);
    },
    [writeText],
  );

  const handleCopyRelativePath = useCallback(
    async (path: string) => {
      if (!rootFolderPath) {
        // If no project is open, copy the full path
        await writeText(path);
        return;
      }

      // Calculate relative path
      let relativePath = path;
      if (path.startsWith(rootFolderPath)) {
        relativePath = path.slice(rootFolderPath.length);
        // Remove leading slash if present
        if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
          relativePath = relativePath.slice(1);
        }
      }

      await writeText(relativePath);
    },
    [rootFolderPath, writeText],
  );

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });
  };

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose) return;

    const buffer = buffers.find((b) => b.id === pendingClose.bufferId);
    if (!buffer) return;

    // Save the file
    await handleSave();

    // Then proceed with closing
    confirmCloseWithoutSaving();
  }, [pendingClose, buffers, handleSave, confirmCloseWithoutSaving]);

  const handleDiscardAndClose = useCallback(() => {
    confirmCloseWithoutSaving();
  }, [confirmCloseWithoutSaving]);

  const handleCancelClose = useCallback(() => {
    cancelPendingClose();
  }, [cancelPendingClose]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const buffer = sortedBuffers[index];

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (index > 0) {
            const prevBuffer = sortedBuffers[index - 1];
            handleTabClick(prevBuffer.id);
            updateActivePath(prevBuffer.path);
            setSrAnnouncement(
              `Switched to ${prevBuffer.name}${prevBuffer.isDirty ? ", unsaved changes" : ""}`,
            );
            tabRefs.current[index - 1]?.focus();
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (index < sortedBuffers.length - 1) {
            const nextBuffer = sortedBuffers[index + 1];
            handleTabClick(nextBuffer.id);
            updateActivePath(nextBuffer.path);
            setSrAnnouncement(
              `Switched to ${nextBuffer.name}${nextBuffer.isDirty ? ", unsaved changes" : ""}`,
            );
            tabRefs.current[index + 1]?.focus();
          }
          break;

        case "Home":
          e.preventDefault();
          if (sortedBuffers.length > 0) {
            const firstBuffer = sortedBuffers[0];
            handleTabClick(firstBuffer.id);
            updateActivePath(firstBuffer.path);
            setSrAnnouncement(
              `Switched to ${firstBuffer.name}${firstBuffer.isDirty ? ", unsaved changes" : ""}`,
            );
            tabRefs.current[0]?.focus();
          }
          break;

        case "End":
          e.preventDefault();
          if (sortedBuffers.length > 0) {
            const lastIndex = sortedBuffers.length - 1;
            const lastBuffer = sortedBuffers[lastIndex];
            handleTabClick(lastBuffer.id);
            updateActivePath(lastBuffer.path);
            setSrAnnouncement(
              `Switched to ${lastBuffer.name}${lastBuffer.isDirty ? ", unsaved changes" : ""}`,
            );
            tabRefs.current[lastIndex]?.focus();
          }
          break;

        case "Delete":
        case "Backspace":
          if (!buffer.isPinned) {
            e.preventDefault();
            setSrAnnouncement(`Closed ${buffer.name}`);
            handleTabClose(buffer.id);
            clearPositionCache(buffer.id);
          } else {
            setSrAnnouncement(`Cannot close pinned tab ${buffer.name}`);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          handleTabClick(buffer.id);
          updateActivePath(buffer.path);
          setSrAnnouncement(`Activated ${buffer.name}${buffer.isDirty ? ", unsaved changes" : ""}`);
          break;
      }
    },
    [sortedBuffers, handleTabClick, updateActivePath, handleTabClose, clearPositionCache],
  );

  const MemoizedTabContextMenu = useMemo(() => TabContextMenu, []);

  // Hide tab bar when no buffers are open
  if (buffers.length === 0) {
    return null;
  }

  const { isDragging, draggedIndex, dropTargetIndex, currentPosition } = dragState;

  return (
    <>
      <div className="relative shrink-0 border-border border-b">
        <div
          ref={tabBarRef}
          className="flex overflow-x-auto overflow-y-hidden bg-secondary-bg [-ms-overflow-style:none] [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Open files"
          onWheel={handleWheel}
        >
          {sortedBuffers.map((buffer, index) => {
            const isActive = buffer.id === activeBufferId;
            const isDraggedTab = isDragging && draggedIndex === index;
            const showDropIndicatorBefore =
              isDragging && dropTargetIndex === index && draggedIndex !== index;
            return (
              <TabBarItem
                key={buffer.id}
                buffer={buffer}
                displayName={displayNames.get(buffer.id) || buffer.name}
                index={index}
                isActive={isActive}
                isDraggedTab={isDraggedTab}
                showDropIndicatorBefore={showDropIndicatorBefore}
                tabRef={(el) => {
                  tabRefs.current[index] = el;
                }}
                onMouseDown={(e) => handleMouseDown(e, index)}
                onDoubleClick={(e) => handleDoubleClick(e, index)}
                onContextMenu={(e) => handleContextMenu(e, buffer)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                handleTabClose={(id) => {
                  handleTabClose(id);
                  // Clear cached position for this buffer
                  clearPositionCache(id);
                }}
                handleTabPin={handleTabPin}
              />
            );
          })}

          {isDragging && dropTargetIndex === sortedBuffers.length && (
            <div className="relative">
              <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
            </div>
          )}

          <div className="flex shrink-0 items-center px-1">
            <NewTabMenu />
          </div>
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
        onPin={handleTabPin}
        onCloseTab={(bufferId) => {
          const buffer = buffers.find((b) => b.id === bufferId);
          if (buffer) {
            handleTabClose(bufferId);
          }
        }}
        onCloseOthers={handleCloseOtherTabs}
        onCloseAll={handleCloseAllTabs}
        onCloseToRight={handleCloseTabsToRight}
        onCopyPath={handleCopyPath}
        onCopyRelativePath={handleCopyRelativePath}
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
        onRevealInFinder={handleRevealInFolder}
      />

      {pendingClose && (
        <UnsavedChangesDialog
          fileName={buffers.find((b) => b.id === pendingClose.bufferId)?.name || ""}
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={handleCancelClose}
        />
      )}

      {/* Screen reader live region for announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {srAnnouncement}
      </div>
    </>
  );
};

export default TabBar;

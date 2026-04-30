import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsOut as Maximize2,
  ArrowsIn as Minimize2,
  SidebarSimple as PanelLeftClose,
  SplitHorizontal as SplitSquareHorizontal,
} from "@phosphor-icons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useJumpListStore } from "@/features/editor/stores/jump-list-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { formatDiffBufferLabel } from "@/features/git/utils/diff-buffer-label";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { findPaneGroup } from "@/features/panes/utils/pane-tree";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { useSettingsStore } from "@/features/settings/store";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { useEditorAppStore } from "@/features/editor/stores/editor-app-store";
import { useSidebarStore } from "@/features/layout/stores/sidebar-store";
import { useTerminalStore } from "@/features/terminal/stores/terminal-store";
import UnsavedChangesDialog from "@/features/window/components/unsaved-changes-dialog";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { getRelativePath } from "@/utils/path-helpers";
import { calculateDisplayNames } from "../utils/path-shortener";
import {
  clearInternalTabDragData,
  resolveDropTarget,
  setInternalTabDragHover,
  setInternalTabDragData,
} from "../utils/internal-tab-drag";
import { NewTabMenu } from "./new-tab-menu";
import TabBarItem from "./tab-bar-item";
import TabContextMenu from "./tab-context-menu";

interface TabBarProps {
  paneId?: string;
  onTabClick?: (bufferId: string) => void;
  disablePaneActions?: boolean;
}

const TabBar = ({
  paneId,
  onTabClick: externalTabClick,
  disablePaneActions = false,
}: TabBarProps) => {
  // Get everything from stores
  const allBuffers = useBufferStore.use.buffers();
  const globalActiveBufferId = useBufferStore.use.activeBufferId();
  const pendingClose = useBufferStore.use.pendingClose();
  const paneRoot = usePaneStore.use.root();
  const bottomRoot = usePaneStore.use.bottomRoot();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const { moveBufferToPane, setActivePane, splitPane, closePane, togglePaneFullscreen } =
    usePaneStore.use.actions();

  // Filter buffers by paneId if provided
  const pane = paneId
    ? paneId === BOTTOM_PANE_ID
      ? findPaneGroup(bottomRoot, BOTTOM_PANE_ID)
      : findPaneGroup(paneRoot, paneId)
    : null;
  const buffers = pane ? allBuffers.filter((b) => pane.bufferIds.includes(b.id)) : allBuffers;
  const activeBufferId = pane ? pane.activeBufferId : globalActiveBufferId;
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
  const { handleSave } = useEditorAppStore.use.actions();
  const { settings } = useSettingsStore();
  const { updateActivePath } = useSidebarStore();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.() || undefined;
  const jumpListActions = useJumpListStore.use.actions();
  const canGoBack = jumpListActions.canGoBack();
  const canGoForward = jumpListActions.canGoForward();
  const isPaneFullscreen = paneId ? fullscreenPaneId === paneId : false;
  const isInSplit = paneRoot.type === "split";
  const isBottomPane = paneId === BOTTOM_PANE_ID;

  const [draggedBufferId, setDraggedBufferId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    buffer: PaneContent | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, buffer: null });

  const [srAnnouncement, setSrAnnouncement] = useState<string>("");

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();
  const { clearPositionCache } = useEditorStateStore.getState().actions;
  const terminalSessions = useTerminalStore((state) => state.sessions);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const getDirectoryLabel = useCallback((directory?: string) => {
    if (!directory) return "";
    const normalized = directory.replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || directory;
  }, []);

  const getCommandLabel = useCallback((command?: string) => {
    if (!command) return "";
    const firstSegment = command.trim().split(/\s+/)[0];
    return firstSegment?.split(/[\\/]/).pop() || "";
  }, []);

  const isUsefulTerminalTitle = useCallback((title?: string) => {
    if (!title) return false;
    const trimmed = title.trim();
    if (!trimmed || trimmed === "Default Terminal") return false;
    if (trimmed.length > 28) return false;
    if (trimmed.includes("@")) return false;
    if (trimmed.includes("/") || trimmed.includes("\\")) return false;

    for (const char of trimmed) {
      const code = char.charCodeAt(0);
      if ((code >= 0 && code <= 31) || code === 127 || code === 155) {
        return false;
      }
    }

    return true;
  }, []);

  const handleJumpBack = useCallback(async () => {
    const bufferStore = useBufferStore.getState();
    const editorState = useEditorStateStore.getState();
    const currentActiveBufferId = bufferStore.activeBufferId;
    const currentActiveBuffer = bufferStore.buffers.find((b) => b.id === currentActiveBufferId);

    const currentPosition =
      currentActiveBufferId && currentActiveBuffer?.path
        ? {
            bufferId: currentActiveBufferId,
            filePath: currentActiveBuffer.path,
            line: editorState.cursorPosition.line,
            column: editorState.cursorPosition.column,
            offset: editorState.cursorPosition.offset,
            scrollTop: editorState.scrollTop,
            scrollLeft: editorState.scrollLeft,
          }
        : undefined;

    const entry = jumpListActions.goBack(currentPosition);
    if (entry) {
      await navigateToJumpEntry(entry);
    }
  }, [jumpListActions]);

  const handleJumpForward = useCallback(async () => {
    const entry = jumpListActions.goForward();
    if (entry) {
      await navigateToJumpEntry(entry);
    }
  }, [jumpListActions]);

  const handleSplitActivePane = useCallback(() => {
    if (!paneId) return;

    // Terminal, agent, and other session-based buffers cannot be shared
    // across panes — open the new split with an empty new-tab view instead.
    const activeBuffer = buffers.find((b) => b.id === activeBufferId);
    const isSessionBuffer =
      activeBuffer &&
      (activeBuffer.type === "terminal" ||
        activeBuffer.type === "agent" ||
        activeBuffer.type === "webViewer");

    splitPane(paneId, "horizontal", isSessionBuffer ? undefined : (activeBufferId ?? undefined));
  }, [activeBufferId, buffers, paneId, splitPane]);

  const handleTogglePaneFullscreen = useCallback(() => {
    if (!paneId) return;
    togglePaneFullscreen(paneId);
  }, [paneId, togglePaneFullscreen]);

  const canScrollTabsHorizontally = useCallback(() => {
    const container = tabBarRef.current;
    if (!container) return false;

    return container.scrollWidth > container.clientWidth + 1;
  }, []);

  // Optional wheel-to-horizontal scrolling for overflowing tab strips.
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const container = tabBarRef.current;
      if (!container) return;
      if (!settings.horizontalTabScroll) return;
      if (draggedBufferId) return;
      if (e.ctrlKey || e.metaKey) return;
      if (!canScrollTabsHorizontally()) return;

      const hasHorizontalIntent = Math.abs(e.deltaX) > 0;
      const hasShiftedVerticalIntent = e.shiftKey && Math.abs(e.deltaY) > 0;
      const hasVerticalFallback = Math.abs(e.deltaX) === 0 && Math.abs(e.deltaY) > 0;

      if (!hasHorizontalIntent && !hasShiftedVerticalIntent && !hasVerticalFallback) {
        return;
      }

      const delta = hasHorizontalIntent ? e.deltaX : e.deltaY;
      if (delta === 0) return;

      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      if (maxScrollLeft <= 0) return;

      const nextScrollLeft = Math.max(0, Math.min(container.scrollLeft + delta, maxScrollLeft));
      if (nextScrollLeft === container.scrollLeft) return;

      e.preventDefault();
      container.scrollLeft = nextScrollLeft;
    },
    [canScrollTabsHorizontally, draggedBufferId, settings.horizontalTabScroll],
  );

  const sortedBuffers = useMemo(() => {
    return [...buffers].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });
  }, [buffers]);
  const sortedBufferIds = useMemo(() => sortedBuffers.map((buffer) => buffer.id), [sortedBuffers]);
  const draggedBuffer = useMemo(
    () => sortedBuffers.find((buffer) => buffer.id === draggedBufferId) ?? null,
    [draggedBufferId, sortedBuffers],
  );

  // Calculate display names for tabs with minimal distinguishing paths
  const displayNames = useMemo(() => {
    return calculateDisplayNames(buffers, rootFolderPath);
  }, [buffers, rootFolderPath]);

  const getBufferDisplayName = useCallback(
    (buffer: PaneContent) => {
      if (buffer.type === "terminal") {
        const session = terminalSessions.get(buffer.sessionId);
        const title = session?.title?.trim();
        if (isUsefulTerminalTitle(title)) return title!;

        const commandLabel = getCommandLabel(buffer.initialCommand);
        if (commandLabel) return commandLabel;

        const dirLabel = getDirectoryLabel(session?.currentDirectory || buffer.workingDirectory);
        if (dirLabel) return dirLabel;
      }

      if (buffer.type === "diff") {
        return formatDiffBufferLabel(displayNames.get(buffer.id) || buffer.name, buffer.path);
      }

      return displayNames.get(buffer.id) ?? buffer.name;
    },
    [displayNames, getCommandLabel, getDirectoryLabel, isUsefulTerminalTitle, terminalSessions],
  );

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

  const handleContextMenu = useCallback((e: React.MouseEvent, buffer: PaneContent) => {
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

      await writeText(getRelativePath(path, rootFolderPath));
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

  const handleTabSelect = useCallback(
    (buffer: PaneContent) => {
      if (externalTabClick) {
        externalTabClick(buffer.id);
      } else {
        handleTabClick(buffer.id);
      }
      updateActivePath(buffer.path);
      setSrAnnouncement(
        `Switched to ${buffer.name}${buffer.type === "editor" && buffer.isDirty ? ", unsaved changes" : ""}`,
      );
    },
    [externalTabClick, handleTabClick, updateActivePath],
  );

  const getClientPoint = (event: Event) => {
    const candidate = event as Partial<MouseEvent>;
    if (typeof candidate.clientX === "number" && typeof candidate.clientY === "number") {
      return { x: candidate.clientX, y: candidate.clientY };
    }
    return null;
  };

  const getDragPoint = (event: DragMoveEvent | DragEndEvent) => {
    if (pointerPointRef.current) return pointerPointRef.current;

    const rect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    if (!rect) return dragPointRef.current;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

  const isPointOutsideTabBar = (point: { x: number; y: number }) => {
    const rect = tabBarRef.current?.getBoundingClientRect();
    if (!rect) return false;

    const horizontalSlop = 24;
    const verticalSlop = 64;
    return (
      point.x < rect.left - horizontalSlop ||
      point.x > rect.right + horizontalSlop ||
      point.y < rect.top - verticalSlop ||
      point.y > rect.bottom + verticalSlop
    );
  };

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const buffer = sortedBuffers.find((item) => item.id === String(event.active.id));
      if (!buffer) return;

      setDraggedBufferId(buffer.id);
      pointerPointRef.current = getClientPoint(event.activatorEvent);
      setInternalTabDragData({
        source: "pane",
        bufferId: buffer.id,
        paneId,
      });
      handleTabSelect(buffer);
    },
    [handleTabSelect, paneId, sortedBuffers],
  );

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const point = getDragPoint(event);
    if (!point) return;

    dragPointRef.current = point;
    if (isPointOutsideTabBar(point)) {
      setInternalTabDragHover(point);
    }
  }, []);

  const resetDrag = useCallback(() => {
    setDraggedBufferId(null);
    dragPointRef.current = null;
    pointerPointRef.current = null;
    clearInternalTabDragData();
  }, []);

  useEffect(() => {
    if (!draggedBufferId) return;

    const updatePointerPoint = (event: PointerEvent) => {
      pointerPointRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener("pointermove", updatePointerPoint, true);
    return () => window.removeEventListener("pointermove", updatePointerPoint, true);
  }, [draggedBufferId]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const dragged = sortedBuffers.find((buffer) => buffer.id === activeId);
      const point = getDragPoint(event);
      const target = point ? resolveDropTarget(point) : { paneId: null, zone: null };
      const isOutsideTabBar = point ? isPointOutsideTabBar(point) : false;

      if (
        dragged &&
        paneId &&
        isOutsideTabBar &&
        target.paneId &&
        (target.paneId !== paneId || (target.zone && target.zone !== "center"))
      ) {
        let destinationPaneId = target.paneId;
        const preserveEmptySource = target.paneId === paneId;
        if (target.zone && target.zone !== "center") {
          const direction =
            target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
          const placement = target.zone === "left" || target.zone === "top" ? "before" : "after";
          destinationPaneId =
            splitPane(target.paneId, direction, undefined, placement) ?? target.paneId;
        }

        setActivePane(destinationPaneId);
        moveBufferToPane(dragged.id, paneId, destinationPaneId, preserveEmptySource);
        if (destinationPaneId === BOTTOM_PANE_ID) {
          useUIState.getState().setBottomPaneActiveTab("buffers");
          useUIState.getState().setIsBottomPaneVisible(true);
        }
      } else if (event.over && reorderBuffers) {
        const oldIndex = sortedBuffers.findIndex((buffer) => buffer.id === activeId);
        const newIndex = sortedBuffers.findIndex((buffer) => buffer.id === String(event.over?.id));
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          reorderBuffers(oldIndex, newIndex);
          if (dragged) {
            handleTabClick(dragged.id);
          }
        }
      }

      resetDrag();
    },
    [
      handleTabClick,
      moveBufferToPane,
      paneId,
      reorderBuffers,
      resetDrag,
      setActivePane,
      sortedBuffers,
      splitPane,
    ],
  );

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
              `Switched to ${prevBuffer.name}${prevBuffer.type === "editor" && prevBuffer.isDirty ? ", unsaved changes" : ""}`,
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
              `Switched to ${nextBuffer.name}${nextBuffer.type === "editor" && nextBuffer.isDirty ? ", unsaved changes" : ""}`,
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
              `Switched to ${firstBuffer.name}${firstBuffer.type === "editor" && firstBuffer.isDirty ? ", unsaved changes" : ""}`,
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
              `Switched to ${lastBuffer.name}${lastBuffer.type === "editor" && lastBuffer.isDirty ? ", unsaved changes" : ""}`,
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
          setSrAnnouncement(
            `Activated ${buffer.name}${buffer.type === "editor" && buffer.isDirty ? ", unsaved changes" : ""}`,
          );
          break;
      }
    },
    [sortedBuffers, handleTabClick, updateActivePath, handleTabClose, clearPositionCache],
  );

  const MemoizedTabContextMenu = useMemo(() => TabContextMenu, []);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDrag}
      >
        <div
          ref={tabBarRef}
          data-tab-bar-pane-id={paneId ?? ""}
          className="relative flex shrink-0 items-center gap-1 overflow-hidden bg-primary-bg px-1.5 py-1"
          role="tablist"
          aria-label="Open files"
          onWheel={handleWheel}
        >
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              onClick={handleJumpBack}
              disabled={!canGoBack}
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-lg text-text-lighter"
              tooltip="Go Back"
              tooltipSide="bottom"
              commandId="navigation.goBack"
              aria-label="Go back to previous location"
            >
              <ArrowLeft />
            </Button>
            <Button
              type="button"
              onClick={handleJumpForward}
              disabled={!canGoForward}
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-lg text-text-lighter"
              tooltip="Go Forward"
              tooltipSide="bottom"
              commandId="navigation.goForward"
              aria-label="Go forward to next location"
            >
              <ArrowRight />
            </Button>
          </div>

          <SortableContext items={sortedBufferIds} strategy={horizontalListSortingStrategy}>
            <div className="scrollbar-hidden flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden [overscroll-behavior-x:contain]">
              {sortedBuffers.map((buffer, index) => (
                <SortableEditorTab
                  key={buffer.id}
                  id={buffer.id}
                  tabRef={(el) => {
                    tabRefs.current[index] = el;
                  }}
                >
                  <TabBarItem
                    buffer={buffer}
                    displayName={getBufferDisplayName(buffer)}
                    index={index}
                    isActive={buffer.id === activeBufferId}
                    isDraggedTab={buffer.id === draggedBufferId}
                    onClick={() => handleTabSelect(buffer)}
                    onDoubleClick={(e) => handleDoubleClick(e, index)}
                    onContextMenu={(e) => handleContextMenu(e, buffer)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    handleTabClose={(id) => {
                      handleTabClose(id);
                      clearPositionCache(id);
                    }}
                    handleTabPin={handleTabPin}
                  />
                </SortableEditorTab>
              ))}
            </div>
          </SortableContext>

          <div className="flex shrink-0 items-center gap-1 pl-0.5">
            {paneId && !disablePaneActions && !isBottomPane && isInSplit && (
              <Button
                type="button"
                onClick={() => closePane(paneId)}
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-lg text-text-lighter"
                tooltip="Close Split"
                tooltipSide="bottom"
                aria-label="Close split pane"
              >
                <PanelLeftClose />
              </Button>
            )}
            {paneId && !disablePaneActions && !isBottomPane && activeBufferId && (
              <Button
                type="button"
                onClick={handleSplitActivePane}
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-lg text-text-lighter"
                tooltip="Split Editor"
                tooltipSide="bottom"
                aria-label="Split editor"
              >
                <SplitSquareHorizontal />
              </Button>
            )}
            {paneId && !disablePaneActions && !isBottomPane && (
              <Button
                type="button"
                onClick={handleTogglePaneFullscreen}
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-lg text-text-lighter"
                tooltip={isPaneFullscreen ? "Exit Full Screen" : "Full Screen Editor"}
                tooltipSide="bottom"
                aria-label="Toggle editor full screen"
              >
                {isPaneFullscreen ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
            <div className="flex shrink-0 items-center">
              <NewTabMenu />
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedBuffer ? (
            <div className="tab-drag-preview ui-font flex items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/95 px-2 py-1 text-xs opacity-95 shadow-sm">
              <span className="max-w-[200px] truncate text-text">{draggedBuffer.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <MemoizedTabContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        buffer={contextMenu.buffer}
        paneId={paneId}
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
          const buffer = buffers.find((b) => b.id === bufferId);
          if (buffer && buffer.path !== "extensions://marketplace") {
            const { closeBuffer, openBuffer } = useBufferStore.getState().actions;
            closeBuffer(bufferId);
            setTimeout(async () => {
              try {
                const content =
                  buffer.type === "editor" || buffer.type === "diff" ? buffer.content : "";
                openBuffer(
                  buffer.path,
                  buffer.name,
                  content,
                  buffer.type === "image",
                  undefined, // databaseType
                  buffer.type === "diff",
                );
              } catch (error) {
                console.error("Failed to reload buffer:", error);
              }
            }, 100);
          }
        }}
        onRevealInFinder={handleRevealInFolder}
        onSplitRight={
          paneId
            ? (targetPaneId, bufferId) => {
                const { splitPane } = usePaneStore.getState().actions;
                splitPane(targetPaneId, "horizontal", bufferId);
              }
            : undefined
        }
        onSplitDown={
          paneId
            ? (targetPaneId, bufferId) => {
                const { splitPane } = usePaneStore.getState().actions;
                splitPane(targetPaneId, "vertical", bufferId);
              }
            : undefined
        }
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

interface SortableEditorTabProps {
  id: string;
  children: ReactNode;
  tabRef: (element: HTMLDivElement | null) => void;
}

function SortableEditorTab({ id, children, tabRef }: SortableEditorTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={(element) => {
        setNodeRef(element);
        tabRef(element);
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={isDragging ? "relative z-10 opacity-40" : "relative"}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export default TabBar;

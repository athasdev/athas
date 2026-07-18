import { type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowsOutIcon as Maximize2,
  ArrowsInIcon as Minimize2,
  PlusIcon as Plus,
  SidebarSimpleIcon as PanelLeftClose,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { formatDiffBufferLabel } from "@/features/git/utils/diff-buffer-label";
import { writeClipboardText } from "@/utils/clipboard";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import { splitEditorGroup } from "@/features/panes/utils/pane-command-actions";
import { moveBufferToPaneDropTarget } from "@/features/panes/utils/pane-drop-actions";
import { findPaneGroup } from "@/features/panes/utils/pane-tree";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useWebViewerNavigationStore } from "@/features/web-viewer/stores/web-viewer-navigation.store";
import UnsavedChangesDialog from "@/features/window/components/unsaved-changes-dialog";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/ui/context-menu";
import { SortableTab, TabBarSurface, TabDndContext, useTabDragClickGuard } from "@/ui/tabs";
import { getRelativePath } from "@/utils/path-helpers";
import { calculateDisplayNames } from "../utils/path-shortener";
import {
  clearInternalTabDragData,
  resolveDropTarget,
  setInternalTabDragHover,
  setInternalTabDragData,
} from "../utils/internal-tab-drag";
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
  const pendingClose = useBufferStore.use.pendingClose();
  const paneRoot = usePaneStore.use.root();
  const bottomRoot = usePaneStore.use.bottomRoot();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const { closePane, setActivePane, togglePaneFullscreen, setPaneLocked } =
    usePaneStore.use.actions();

  const pane = useMemo(() => {
    if (!paneId) return null;
    return paneId === BOTTOM_PANE_ID
      ? findPaneGroup(bottomRoot, BOTTOM_PANE_ID)
      : findPaneGroup(paneRoot, paneId);
  }, [bottomRoot, paneId, paneRoot]);
  const paneBufferIdSet = useMemo(() => {
    return pane ? new Set(pane.bufferIds) : null;
  }, [pane?.bufferIds]);
  const buffers = useBufferStore((state) => {
    const visibleBuffers = paneBufferIdSet
      ? state.buffers.filter((buffer) => paneBufferIdSet.has(buffer.id))
      : state.buffers;
    return visibleBuffers.filter((buffer) => buffer.type !== "newTab");
  });
  const globalActiveBufferId = useBufferStore((state) => (pane ? null : state.activeBufferId));
  const activeBufferCandidate = pane ? pane.activeBufferId : globalActiveBufferId;
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
    showNewTabView,
  } = useBufferStore.use.actions();
  const { handleSave } = useEditorAppStore.use.actions();
  const horizontalTabScroll = useSettingsStore((state) => state.settings.horizontalTabScroll);
  const maxOpenTabs = useSettingsStore((state) => state.settings.maxOpenTabs);
  const updateActivePath = useSidebarStore.use.updateActivePath();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.() || undefined;
  const jumpListActions = useJumpListStore.use.actions();
  const bufferById = useMemo(() => {
    const nextBufferById = new Map<string, PaneContent>();
    for (const buffer of buffers) {
      nextBufferById.set(buffer.id, buffer);
    }
    return nextBufferById;
  }, [buffers]);
  const activeBufferId =
    activeBufferCandidate && bufferById.has(activeBufferCandidate) ? activeBufferCandidate : null;
  const activeBuffer = activeBufferId ? (bufferById.get(activeBufferId) ?? null) : null;
  const activeWebViewerNavigation = useWebViewerNavigationStore((state) =>
    activeBuffer?.type === "webViewer" ? state.navigationByBufferId[activeBuffer.id] : undefined,
  );
  const usesWebViewerNavigation = activeBuffer?.type === "webViewer";
  const canGoBack = usesWebViewerNavigation
    ? Boolean(activeWebViewerNavigation?.canGoBack)
    : jumpListActions.canGoBack();
  const canGoForward = usesWebViewerNavigation
    ? Boolean(activeWebViewerNavigation?.canGoForward)
    : jumpListActions.canGoForward();
  const isPaneFullscreen = paneId ? fullscreenPaneId === paneId : false;
  const isPaneLocked = Boolean(pane?.locked);
  const isInSplit = paneRoot.type === "split";
  const isBottomPane = paneId === BOTTOM_PANE_ID;

  const [draggedBufferId, setDraggedBufferId] = useState<string | null>(null);

  const [srAnnouncement, setSrAnnouncement] = useState<string>("");

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const { getClickCapture, releaseClickSuppression, suppressNextClick } = useTabDragClickGuard();
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();
  const { clearPositionCache } = useEditorStateStore.getState().actions;
  const terminalSessions = useTerminalStore((state) => state.sessions);
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
    if (usesWebViewerNavigation) {
      activeWebViewerNavigation?.goBack?.();
      return;
    }

    const bufferStore = useBufferStore.getState();
    const editorState = useEditorStateStore.getState();
    const currentActiveBufferId = bufferStore.activeBufferId;
    const currentActiveBuffer = getBufferById(bufferStore.buffers, currentActiveBufferId);

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
  }, [activeWebViewerNavigation, jumpListActions, usesWebViewerNavigation]);

  const handleJumpForward = useCallback(async () => {
    if (usesWebViewerNavigation) {
      activeWebViewerNavigation?.goForward?.();
      return;
    }

    const entry = jumpListActions.goForward();
    if (entry) {
      await navigateToJumpEntry(entry);
    }
  }, [activeWebViewerNavigation, jumpListActions, usesWebViewerNavigation]);

  const handleShowNewTab = useCallback(() => {
    if (!paneId) return;
    setActivePane(paneId);
    showNewTabView();
  }, [paneId, setActivePane, showNewTabView]);

  const handleTogglePaneFullscreen = useCallback(() => {
    if (!paneId) return;
    togglePaneFullscreen(paneId);
  }, [paneId, togglePaneFullscreen]);

  const handleTogglePaneLocked = useCallback(() => {
    if (!paneId) return;
    setPaneLocked(paneId, !isPaneLocked);
  }, [isPaneLocked, paneId, setPaneLocked]);

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
      if (!horizontalTabScroll) return;
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
    [canScrollTabsHorizontally, draggedBufferId, horizontalTabScroll],
  );

  const sortedBuffers = useMemo(() => {
    const pinnedBuffers: PaneContent[] = [];
    const unpinnedBuffers: PaneContent[] = [];

    for (const buffer of buffers) {
      if (buffer.isPinned) {
        pinnedBuffers.push(buffer);
      } else {
        unpinnedBuffers.push(buffer);
      }
    }

    if (pinnedBuffers.length === 0) return unpinnedBuffers;
    if (unpinnedBuffers.length === 0) return pinnedBuffers;
    return [...pinnedBuffers, ...unpinnedBuffers];
  }, [buffers]);
  const { sortedBufferIds, sortedBufferIndexById } = useMemo(() => {
    const ids: string[] = [];
    const indexById = new Map<string, number>();

    for (let index = 0; index < sortedBuffers.length; index++) {
      const buffer = sortedBuffers[index];
      ids.push(buffer.id);
      indexById.set(buffer.id, index);
    }

    return { sortedBufferIds: ids, sortedBufferIndexById: indexById };
  }, [sortedBuffers]);
  // Calculate display names for tabs with minimal distinguishing paths
  const displayNames = useMemo(() => {
    return calculateDisplayNames(buffers, rootFolderPath);
  }, [buffers, rootFolderPath]);

  const getBufferDisplayName = useCallback(
    (buffer: PaneContent) => {
      if (buffer.type === "terminal") {
        const session = terminalSessions.get(buffer.sessionId);
        if (session?.customName) {
          return session.name?.trim() || buffer.name;
        }

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
    if (maxOpenTabs > 0 && buffers.length > maxOpenTabs && handleTabClose) {
      const closableBuffers = buffers.filter((b) => !b.isPinned && b.id !== activeBufferId);

      let tabsToClose = buffers.length - maxOpenTabs;
      for (let i = 0; i < closableBuffers.length && tabsToClose > 0; i++) {
        handleTabClose(closableBuffers[i].id);
        tabsToClose--;
      }
    }
  }, [buffers, maxOpenTabs, activeBufferId, handleTabClose]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const activeIndex = activeBufferId ? (sortedBufferIndexById.get(activeBufferId) ?? -1) : -1;
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
  }, [activeBufferId, sortedBufferIndexById]);

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

  const handleCopyPath = useCallback(async (path: string) => {
    await writeClipboardText(path);
  }, []);

  const handleCopyRelativePath = useCallback(
    async (path: string) => {
      if (!rootFolderPath) {
        // If no project is open, copy the full path
        await writeClipboardText(path);
        return;
      }

      await writeClipboardText(getRelativePath(path, rootFolderPath));
    },
    [rootFolderPath],
  );

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose) return;

    const buffer = bufferById.get(pendingClose.bufferId);
    if (!buffer) return;

    // Save the file
    await handleSave();

    // Then proceed with closing
    confirmCloseWithoutSaving();
  }, [pendingClose, bufferById, handleSave, confirmCloseWithoutSaving]);

  const handleDiscardAndClose = useCallback(() => {
    confirmCloseWithoutSaving();
  }, [confirmCloseWithoutSaving]);

  const handleCancelClose = useCallback(() => {
    cancelPendingClose();
  }, [cancelPendingClose]);

  const closeTab = useCallback(
    (bufferId: string) => {
      handleTabClose(bufferId);
      clearPositionCache(bufferId);
    },
    [clearPositionCache, handleTabClose],
  );

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
      const buffer = bufferById.get(String(event.active.id));
      if (!buffer) return;

      setDraggedBufferId(buffer.id);
      pointerPointRef.current = getClientPoint(event.activatorEvent);
      setInternalTabDragData({
        source: "pane",
        bufferId: buffer.id,
        paneId,
      });
      suppressNextClick(buffer.id);
    },
    [bufferById, paneId, suppressNextClick],
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
    releaseClickSuppression();
  }, [releaseClickSuppression]);

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
      const dragged = bufferById.get(activeId);
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
        const preserveEmptySource = target.paneId === paneId;
        const destinationPaneId = moveBufferToPaneDropTarget(
          dragged.id,
          paneId,
          { paneId: target.paneId, zone: target.zone },
          preserveEmptySource,
        );
        if (!destinationPaneId) {
          resetDrag();
          return;
        }
        activateBufferInPaneAndSync(destinationPaneId, dragged.id);
        if (destinationPaneId === BOTTOM_PANE_ID) {
          useUIState.getState().setBottomPaneActiveTab("buffers");
          useUIState.getState().setIsBottomPaneVisible(true);
        }
      } else if (event.over && reorderBuffers) {
        const oldIndex = sortedBufferIndexById.get(activeId) ?? -1;
        const newIndex = sortedBufferIndexById.get(String(event.over.id)) ?? -1;
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          reorderBuffers(oldIndex, newIndex);
        }
      }

      resetDrag();
    },
    [bufferById, paneId, reorderBuffers, resetDrag, sortedBufferIndexById],
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
            closeTab(buffer.id);
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
    [sortedBuffers, handleTabClick, updateActivePath, closeTab],
  );

  return (
    <>
      <TabDndContext
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDrag}
      >
        <TabBarSurface
          ref={tabBarRef}
          data-tab-bar-pane-id={paneId ?? ""}
          className="scrollbar-hidden [overscroll-behavior-x:contain]"
          role="tablist"
          aria-label="Open files"
          onWheel={handleWheel}
        >
          <div className="flex h-8 shrink-0 items-center gap-0.5">
            <Button
              type="button"
              onClick={handleJumpBack}
              disabled={!canGoBack}
              variant="ghost"
              tooltip="Go Back"
              tooltipSide="bottom"
              commandId="navigation.goBack"
              aria-label="Go back to previous location"
              size="icon-xs"
            >
              <ArrowLeft />
            </Button>
            <Button
              type="button"
              onClick={handleJumpForward}
              disabled={!canGoForward}
              variant="ghost"
              tooltip="Go Forward"
              tooltipSide="bottom"
              commandId="navigation.goForward"
              aria-label="Go forward to next location"
              size="icon-xs"
            >
              <ArrowRight />
            </Button>
          </div>

          <SortableContext items={sortedBufferIds} strategy={horizontalListSortingStrategy}>
            <div className="scrollbar-hidden flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden [overscroll-behavior-x:contain]">
              {sortedBuffers.map((buffer, index) => (
                <SortableTab
                  key={buffer.id}
                  id={buffer.id}
                  tabRef={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  onClickCapture={getClickCapture(buffer.id)}
                >
                  {({ isDragging }) => (
                    <ContextMenu>
                      <ContextMenuTrigger className="contents">
                        <TabBarItem
                          buffer={buffer}
                          displayName={getBufferDisplayName(buffer)}
                          index={index}
                          isActive={buffer.id === activeBufferId}
                          isDraggedTab={isDragging}
                          onClick={() => handleTabSelect(buffer)}
                          onDoubleClick={(e) => handleDoubleClick(e, index)}
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          handleTabClose={closeTab}
                          handleTabPin={handleTabPin}
                        />
                      </ContextMenuTrigger>
                      <TabContextMenu
                        buffer={buffer}
                        paneId={paneId}
                        onPin={handleTabPin}
                        onCloseTab={(bufferId) => {
                          const targetBuffer = bufferById.get(bufferId);
                          if (targetBuffer) closeTab(bufferId);
                        }}
                        onCloseOthers={handleCloseOtherTabs}
                        onCloseAll={handleCloseAllTabs}
                        onCloseToRight={handleCloseTabsToRight}
                        isPaneLocked={isPaneLocked}
                        onTogglePaneLocked={
                          paneId && !disablePaneActions && !isBottomPane
                            ? handleTogglePaneLocked
                            : undefined
                        }
                        onCopyPath={handleCopyPath}
                        onCopyRelativePath={handleCopyRelativePath}
                        onReload={(bufferId) => {
                          const targetBuffer = bufferById.get(bufferId);
                          if (targetBuffer && targetBuffer.path !== "extensions://marketplace") {
                            const { closeBuffer, openBuffer } = useBufferStore.getState().actions;
                            closeBuffer(bufferId);
                            setTimeout(async () => {
                              try {
                                const content =
                                  targetBuffer.type === "editor" || targetBuffer.type === "diff"
                                    ? targetBuffer.content
                                    : "";
                                openBuffer(
                                  targetBuffer.path,
                                  targetBuffer.name,
                                  content,
                                  targetBuffer.type === "image",
                                  undefined,
                                  targetBuffer.type === "diff",
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
                                splitEditorGroup(targetPaneId, "horizontal", bufferId);
                              }
                            : undefined
                        }
                        onSplitDown={
                          paneId
                            ? (targetPaneId, bufferId) => {
                                splitEditorGroup(targetPaneId, "vertical", bufferId);
                              }
                            : undefined
                        }
                      />
                    </ContextMenu>
                  )}
                </SortableTab>
              ))}
            </div>
          </SortableContext>

          <div className="flex h-8 shrink-0 items-center gap-1 pl-0.5">
            {paneId && !isBottomPane && (
              <Button
                type="button"
                onClick={handleShowNewTab}
                variant="ghost"
                size="icon-xs"
                tooltip="New Tab"
                tooltipSide="bottom"
                aria-label="New tab"
              >
                <Plus weight="bold" />
              </Button>
            )}
            {paneId && !disablePaneActions && !isBottomPane && isInSplit && (
              <Button
                type="button"
                onClick={() => closePane(paneId)}
                variant="ghost"
                size="icon-xs"
                tooltip="Close Split"
                tooltipSide="bottom"
                aria-label="Close split pane"
              >
                <PanelLeftClose />
              </Button>
            )}
            {paneId && !disablePaneActions && !isBottomPane && (
              <Button
                type="button"
                onClick={handleTogglePaneFullscreen}
                variant="ghost"
                tooltip={isPaneFullscreen ? "Exit Full Screen" : "Full Screen Editor"}
                tooltipSide="bottom"
                aria-label="Toggle editor full screen"
                size="icon-xs"
              >
                {isPaneFullscreen ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          </div>
        </TabBarSurface>
      </TabDndContext>

      {pendingClose && (
        <UnsavedChangesDialog
          fileName={bufferById.get(pendingClose.bufferId)?.name || ""}
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

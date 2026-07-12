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
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  TextAlignCenterIcon as AlignCenter,
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  CaretDownIcon as ChevronDown,
  ArrowsOutIcon as Maximize,
  ArrowsOutIcon as Maximize2,
  ArrowsInIcon as Minimize2,
  PushPinIcon as Pin,
  PlusIcon as Plus,
  MagnifyingGlassIcon as Search,
  TerminalWindowIcon as TerminalIcon,
  SidebarSimpleIcon as PanelLeft,
  SidebarSimpleIcon as PanelRight,
  RowsIcon as Rows3,
} from "@/ui/icons";
import type React from "react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import { getOrCreatePaneDropTarget } from "@/features/panes/utils/pane-drop-actions";
import {
  type TerminalTabLayout,
  type TerminalTabSidebarPosition,
  type TerminalWidthMode,
  useTerminalStore,
} from "@/features/terminal/stores/terminal.store";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { getAllTerminalProfiles } from "@/features/terminal/utils/terminal-profiles";
import { Dropdown, MenuItemsList, type MenuItem } from "@/ui/dropdown";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import {
  clearInternalTabDragData,
  resolveDropTarget,
  setInternalTabDragHover,
  setInternalTabDragData,
} from "@/features/tabs/utils/internal-tab-drag";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Tooltip from "../../../ui/tooltip";
import TerminalTabBarItem from "./terminal-tab-bar-item";
import TerminalTabContextMenu from "./terminal-tab-context-menu";

interface ToolbarContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  currentMode: TerminalWidthMode;
  currentLayout: TerminalTabLayout;
  currentSidebarPosition: TerminalTabSidebarPosition;
  onModeChange: (mode: TerminalWidthMode) => void;
  onLayoutChange: (layout: TerminalTabLayout) => void;
  onSidebarPositionChange: (position: TerminalTabSidebarPosition) => void;
  onNewTerminal?: () => void;
  onSearchTerminal?: () => void;
  onNextTerminal?: () => void;
  onPrevTerminal?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

const ToolbarContextMenu = ({
  isOpen,
  position,
  onClose,
  currentMode,
  currentLayout,
  currentSidebarPosition,
  onModeChange,
  onLayoutChange,
  onSidebarPositionChange,
  onNewTerminal,
  onSearchTerminal,
  onNextTerminal,
  onPrevTerminal,
  onFullScreen,
  isFullScreen,
}: ToolbarContextMenuProps) => {
  const modes: {
    value: TerminalWidthMode;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { value: "full", label: "Full Width", icon: <Maximize /> },
    { value: "editor", label: "Editor Width", icon: <AlignCenter /> },
  ];
  const layouts: {
    value: TerminalTabLayout;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "horizontal",
      label: "Horizontal Tabs",
      icon: <Rows3 />,
    },
    {
      value: "vertical",
      label: "Vertical Tabs",
      icon: <PanelLeft />,
    },
  ];
  const modeItems: MenuItem[] = modes.map((mode) => ({
    id: `mode-${mode.value}`,
    label: mode.label,
    icon: mode.icon,
    onClick: () => onModeChange(mode.value),
    className: currentMode === mode.value ? "bg-selected" : undefined,
  }));
  const layoutItems: MenuItem[] = layouts.map((layout) => ({
    id: `layout-${layout.value}`,
    label: layout.label,
    icon: layout.icon,
    onClick: () => onLayoutChange(layout.value),
    className: currentLayout === layout.value ? "bg-selected" : undefined,
  }));
  const sidebarPositions: {
    value: TerminalTabSidebarPosition;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { value: "left", label: "Tabs on Left", icon: <PanelLeft /> },
    { value: "right", label: "Tabs on Right", icon: <PanelRight /> },
  ];
  const sidebarPositionItems: MenuItem[] = sidebarPositions.map((pos) => ({
    id: `sidebar-pos-${pos.value}`,
    label: pos.label,
    icon: pos.icon,
    onClick: () => onSidebarPositionChange(pos.value),
    className: currentSidebarPosition === pos.value ? "bg-selected" : undefined,
  }));
  const actionItems: MenuItem[] = [
    ...(onNewTerminal
      ? [
          {
            id: "new-terminal",
            label: "New Terminal",
            icon: <Plus />,
            onClick: onNewTerminal,
          },
        ]
      : []),
    ...(onSearchTerminal
      ? [
          {
            id: "search-terminal",
            label: "Search",
            icon: <Search />,
            onClick: onSearchTerminal,
          },
        ]
      : []),
    ...(onNextTerminal
      ? [
          {
            id: "next-terminal",
            label: "Next Tab",
            icon: <ArrowDown />,
            onClick: onNextTerminal,
          },
        ]
      : []),
    ...(onPrevTerminal
      ? [
          {
            id: "previous-terminal",
            label: "Previous Tab",
            icon: <ArrowUp />,
            onClick: onPrevTerminal,
          },
        ]
      : []),
    ...(onFullScreen
      ? [
          {
            id: "toggle-fullscreen",
            label: isFullScreen ? "Exit Full Screen" : "Full Screen",
            icon: isFullScreen ? <Minimize2 /> : <Maximize2 />,
            onClick: onFullScreen,
          },
        ]
      : []),
  ];

  return (
    <Dropdown isOpen={isOpen} point={position} onClose={onClose} className="min-w-[180px]">
      <div className="font-sans ui-text-sm px-2.5 py-1 text-text-lighter">Terminal Width</div>
      <MenuItemsList items={modeItems} onItemSelect={onClose} />
      <div className="my-0.5 border-border/70 border-t" />
      <div className="font-sans ui-text-sm px-2.5 py-1 text-text-lighter">Tab Layout</div>
      <MenuItemsList items={layoutItems} onItemSelect={onClose} />
      {currentLayout === "vertical" && (
        <>
          <div className="my-0.5 border-border/70 border-t" />
          <div className="font-sans ui-text-sm px-2.5 py-1 text-text-lighter">Tab Position</div>
          <MenuItemsList items={sidebarPositionItems} onItemSelect={onClose} />
        </>
      )}
      {actionItems.length > 0 && (
        <>
          <div className="my-0.5 border-border/70 border-t" />
          <MenuItemsList items={actionItems} onItemSelect={onClose} />
        </>
      )}
    </Dropdown>
  );
};

interface TerminalTabBarProps {
  terminals: Terminal[];
  activeTerminalId: string | null;
  onTabClick: (terminalId: string) => void;
  onTabClose: (terminalId: string, event?: React.MouseEvent) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTabPin?: (terminalId: string) => void;
  onTabRename?: (terminalId: string, name: string) => void;
  onNewTerminal?: () => void;
  onNewTerminalWithProfile?: (profileId?: string) => void;
  onTabCreate?: (directory: string, shell?: string, profileId?: string) => void;
  onCloseOtherTabs?: (terminalId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTabsToRight?: (terminalId: string) => void;
  onSearchTerminal?: () => void;
  onNextTerminal?: () => void;
  onPrevTerminal?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
  orientation?: TerminalTabLayout;
}

const TerminalTabBar = ({
  terminals,
  activeTerminalId,
  onTabClick,
  onTabClose,
  onTabReorder,
  onTabPin,
  onTabRename,
  onNewTerminal,
  onNewTerminalWithProfile,
  onTabCreate,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onSearchTerminal,
  onNextTerminal,
  onPrevTerminal,
  onFullScreen,
  isFullScreen = false,
  orientation = "horizontal",
}: TerminalTabBarProps) => {
  const renameStartedAtRef = useRef<number>(0);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedTerminalId, setDraggedTerminalId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    terminal: Terminal | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, terminal: null });

  const [toolbarContextMenu, setToolbarContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  const widthMode = useTerminalStore((state) => state.widthMode);
  const setWidthMode = useTerminalStore((state) => state.setWidthMode);
  const tabLayout = useTerminalStore((state) => state.tabLayout);
  const setTabLayout = useTerminalStore((state) => state.setTabLayout);
  const tabSidebarWidth = useTerminalStore((state) => state.tabSidebarWidth);
  const setTabSidebarWidth = useTerminalStore((state) => state.setTabSidebarWidth);
  const tabSidebarPosition = useTerminalStore((state) => state.tabSidebarPosition);
  const setTabSidebarPosition = useTerminalStore((state) => state.setTabSidebarPosition);
  const sessions = useTerminalStore((state) => state.sessions);
  const customProfiles = useTerminalProfilesStore.use.profiles();
  const availableShells = useTerminalShellsStore.use.shells();
  const { openTerminalBuffer } = useBufferStore.use.actions();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );
  const [profileMenu, setProfileMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  useEffect(() => {
    void useTerminalShellsStore.getState().actions.loadShells();
  }, []);

  const handleContextMenu = (e: React.MouseEvent, terminal: Terminal) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      terminal,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F2" && activeTerminalId) {
      e.preventDefault();
      e.stopPropagation();
      startRename(activeTerminalId);
    }
  };

  const handleTabCloseWrapper = (terminalId: string) => {
    onTabClose(terminalId);
  };

  const handleTabPin = (terminalId: string) => {
    onTabPin?.(terminalId);
  };

  const startRename = (terminalId: string) => {
    const terminal = sortedTerminals.find((item) => item.id === terminalId);
    if (!terminal) return;

    closeContextMenu();
    requestAnimationFrame(() => {
      renameStartedAtRef.current = Date.now();
      onTabClick(terminalId);
      setEditingTerminalId(terminalId);
      setEditingName(getTerminalDisplayName(terminal));
    });
  };

  const cancelRename = () => {
    setEditingTerminalId(null);
    setEditingName("");
  };

  const commitRename = () => {
    if (!editingTerminalId) return;

    const trimmedName = editingName.trim();
    if (!trimmedName) {
      cancelRename();
      return;
    }

    onTabRename?.(editingTerminalId, trimmedName);
    cancelRename();
  };

  const handleRenameBlur = () => {
    if (Date.now() - renameStartedAtRef.current < 150) {
      return;
    }
    commitRename();
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, terminal: null });
  };

  const handleToolbarContextMenu = (e: React.MouseEvent) => {
    // Only open on empty space, not on tabs or buttons
    if ((e.target as HTMLElement).closest('[role="tab"]')) {
      return;
    }
    e.preventDefault();
    setToolbarContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  const closeToolbarContextMenu = () => {
    setToolbarContextMenu({ isOpen: false, position: { x: 0, y: 0 } });
  };

  const closeProfileMenu = () => {
    setProfileMenu({ isOpen: false, position: { x: 0, y: 0 } });
  };

  const openProfileMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setProfileMenu({
      isOpen: true,
      position: { x: rect.right - 220, y: rect.bottom + 8 },
    });
  };

  // Sort terminals: pinned tabs first, then regular tabs
  const sortedTerminals = [...terminals].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });
  const sortedTerminalIds = sortedTerminals.map((terminal) => terminal.id);
  const draggedTerminal =
    sortedTerminals.find((terminal) => terminal.id === draggedTerminalId) ?? null;
  const terminalProfiles = getAllTerminalProfiles(availableShells, customProfiles);
  const terminalToolbarActions = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1",
        orientation === "vertical" ? "border-border/60 border-b px-1.5 py-1" : "px-1",
      )}
    >
      {onSearchTerminal && (
        <Tooltip content="Find in Terminal (Cmd/Ctrl+F)" side="bottom">
          <Button
            onClick={onSearchTerminal}
            variant="ghost"
            className="shrink-0 rounded-lg text-text-lighter"
            size="icon-xs"
          >
            <Search />
          </Button>
        </Tooltip>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content="New Terminal (Cmd+T)" side="bottom">
          <Button
            onClick={onNewTerminal}
            variant="ghost"
            className="shrink-0 rounded-lg text-text-lighter"
            size="icon-xs"
          >
            <Plus />
          </Button>
        </Tooltip>
        {onNewTerminalWithProfile && terminalProfiles.length > 1 && (
          <Tooltip content="Choose Terminal Profile" side="bottom">
            <Button
              ref={profileMenuButtonRef}
              onClick={openProfileMenu}
              variant="ghost"
              className="shrink-0 rounded-lg text-text-lighter"
              size="icon-xs"
            >
              <ChevronDown />
            </Button>
          </Tooltip>
        )}
      </div>
      {onFullScreen && (
        <Tooltip content={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"} side="bottom">
          <Button
            onClick={onFullScreen}
            variant="ghost"
            className="shrink-0 rounded-lg text-text-lighter"
            size="icon-xs"
          >
            {isFullScreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </Tooltip>
      )}
    </div>
  );
  const sortableStrategy =
    orientation === "vertical" ? verticalListSortingStrategy : horizontalListSortingStrategy;
  const pinnedTerminals = sortedTerminals.filter((terminal) => terminal.isPinned);
  const regularTerminals = sortedTerminals.filter((terminal) => !terminal.isPinned);
  const getDirectoryLabel = (directory?: string) => {
    if (!directory) return "";
    const normalized = directory.replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || directory;
  };
  const getCommandLabel = (command?: string) => {
    if (!command) return "";
    const firstSegment = command.trim().split(/\s+/)[0];
    return firstSegment?.split(/[\\/]/).pop() || "";
  };
  const isUsefulTerminalTitle = (title?: string) => {
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
  };
  const getTerminalDisplayName = (terminal: Terminal) => {
    if (terminal.customName && terminal.name.trim()) return terminal.name;

    const session = sessions.get(terminal.id);
    const title = session?.title?.trim();
    if (isUsefulTerminalTitle(title)) return title!;
    const commandLabel = getCommandLabel(terminal.initialCommand);
    if (commandLabel) return commandLabel;
    const dirLabel = getDirectoryLabel(session?.currentDirectory || terminal.currentDirectory);
    if (dirLabel) return dirLabel;
    return terminal.name;
  };
  const profileMenuItems: MenuItem[] = terminalProfiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    icon: <TerminalIcon className="text-text-lighter" />,
    onClick: () => {
      onNewTerminalWithProfile?.(profile.id);
      closeProfileMenu();
    },
  }));

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

    const horizontalSlop = orientation === "vertical" ? 24 : 24;
    const verticalSlop = orientation === "vertical" ? 24 : 64;
    return (
      point.x < rect.left - horizontalSlop ||
      point.x > rect.right + horizontalSlop ||
      point.y < rect.top - verticalSlop ||
      point.y > rect.bottom + verticalSlop
    );
  };

  const resetDrag = () => {
    setDraggedTerminalId(null);
    dragPointRef.current = null;
    pointerPointRef.current = null;
    clearInternalTabDragData();
  };

  const handleDragStart = (event: DragStartEvent) => {
    const terminal = sortedTerminals.find((item) => item.id === String(event.active.id));
    if (!terminal) return;

    setDraggedTerminalId(terminal.id);
    pointerPointRef.current = getClientPoint(event.activatorEvent);
    setInternalTabDragData({
      source: "terminal-panel",
      terminalId: terminal.id,
      name: terminal.name,
      initialCommand: terminal.initialCommand,
      currentDirectory: terminal.currentDirectory,
      remoteConnectionId: terminal.remoteConnectionId,
    });
    onTabClick(terminal.id);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const point = getDragPoint(event);
    if (!point) return;

    dragPointRef.current = point;
    if (isPointOutsideTabBar(point)) {
      setInternalTabDragHover(point);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const terminal = sortedTerminals.find((item) => item.id === activeId);
    const point = getDragPoint(event);
    const target = point ? resolveDropTarget(point) : { paneId: null, zone: null };
    const isOutsideTabBar = point ? isPointOutsideTabBar(point) : false;

    if (terminal && isOutsideTabBar && target.paneId) {
      const destinationPaneId = getOrCreatePaneDropTarget({
        paneId: target.paneId,
        zone: target.zone,
      });
      if (!destinationPaneId) {
        resetDrag();
        return;
      }

      const bufferId = openTerminalBuffer({
        sessionId: terminal.id,
        name: terminal.name,
        command: terminal.initialCommand,
        workingDirectory: terminal.currentDirectory,
        remoteConnectionId: terminal.remoteConnectionId,
      });
      activateBufferInPaneAndSync(destinationPaneId, bufferId);
      window.dispatchEvent(
        new CustomEvent("terminal-detach-to-buffer", {
          detail: { terminalId: terminal.id },
        }),
      );
      if (destinationPaneId === BOTTOM_PANE_ID) {
        useUIState.getState().setBottomPaneActiveTab("buffers");
        useUIState.getState().setIsBottomPaneVisible(true);
      }
    } else if (event.over && onTabReorder) {
      const oldIndex = sortedTerminals.findIndex((item) => item.id === activeId);
      const newIndex = sortedTerminals.findIndex((item) => item.id === String(event.over?.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onTabReorder(oldIndex, newIndex);
        if (terminal) {
          onTabClick(terminal.id);
        }
      }
    }

    resetDrag();
  };

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(() => {
    if (!draggedTerminalId) return;

    const updatePointerPoint = (event: PointerEvent) => {
      pointerPointRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener("pointermove", updatePointerPoint, true);
    return () => window.removeEventListener("pointermove", updatePointerPoint, true);
  }, [draggedTerminalId]);

  useEffect(() => {
    if (
      editingTerminalId &&
      !sortedTerminals.some((terminal) => terminal.id === editingTerminalId)
    ) {
      cancelRename();
    }
  }, [editingTerminalId, sortedTerminals]);

  if (terminals.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-8 items-center justify-between",
          "border-border border-b bg-secondary-bg px-2 py-1.5",
        )}
      >
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="text-text-lighter" />
          <span className="font-sans ui-text-sm text-text-lighter">No terminals</span>
        </div>
        {onNewTerminal && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="New Terminal (Cmd+T)" side="bottom">
              <Button
                onClick={onNewTerminal}
                variant="ghost"
                className="rounded-lg text-text-lighter"
                size="icon-xs"
              >
                <Plus />
              </Button>
            </Tooltip>
            {onNewTerminalWithProfile && terminalProfiles.length > 1 && (
              <Tooltip content="Choose Terminal Profile" side="bottom">
                <Button
                  ref={profileMenuButtonRef}
                  onClick={openProfileMenu}
                  variant="ghost"
                  className="rounded-lg text-text-lighter"
                  size="icon-xs"
                >
                  <ChevronDown />
                </Button>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    );
  }

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
          className={cn(
            orientation === "vertical"
              ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-primary-bg"
              : "relative flex h-7 min-h-7 items-center justify-between gap-1 overflow-hidden bg-primary-bg px-1.5 py-0.5",
            "scrollbar-hidden [overscroll-behavior-x:contain]",
          )}
          style={orientation === "vertical" ? { width: tabSidebarWidth } : undefined}
          role="tablist"
          aria-label="Terminal tabs"
          onContextMenu={handleToolbarContextMenu}
        >
          {orientation === "vertical" && terminalToolbarActions}

          {/* Tab list */}
          <SortableContext items={sortedTerminalIds} strategy={sortableStrategy}>
            <div
              className={cn(
                "min-w-0 flex-1 overflow-hidden",
                orientation === "vertical"
                  ? "flex flex-col gap-0.5 px-1.5 py-1"
                  : "flex items-center gap-1",
              )}
            >
              {pinnedTerminals.length > 0 && (
                <div
                  className={cn(
                    "shrink-0",
                    orientation === "vertical"
                      ? "flex flex-col gap-0.5 pb-0.5"
                      : "flex items-center gap-1 pr-0.5",
                  )}
                >
                  {pinnedTerminals.map((terminal) => {
                    const index = sortedTerminals.findIndex((item) => item.id === terminal.id);

                    return (
                      <SortableTerminalTab
                        key={terminal.id}
                        id={terminal.id}
                        orientation={orientation}
                        tabRef={(el) => {
                          tabRefs.current[index] = el;
                        }}
                        disabled={editingTerminalId === terminal.id}
                      >
                        <TerminalTabBarItem
                          terminal={terminal}
                          displayName={getTerminalDisplayName(terminal)}
                          orientation={orientation}
                          isActive={terminal.id === activeTerminalId}
                          isDraggedTab={terminal.id === draggedTerminalId}
                          showDropIndicatorBefore={false}
                          tabRef={() => {}}
                          onClick={() => onTabClick(terminal.id)}
                          onContextMenu={(e) => handleContextMenu(e, terminal)}
                          onKeyDown={handleKeyDown}
                          handleTabClose={handleTabCloseWrapper}
                          handleTabPin={handleTabPin}
                          isEditing={editingTerminalId === terminal.id}
                          editingName={editingName}
                          onEditingNameChange={setEditingName}
                          onRenameSubmit={commitRename}
                          onRenameCancel={cancelRename}
                          onRenameBlur={handleRenameBlur}
                        />
                      </SortableTerminalTab>
                    );
                  })}
                </div>
              )}

              <div
                className={cn(
                  "scrollbar-hidden min-w-0 flex-1",
                  orientation === "vertical"
                    ? "flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden"
                    : "flex gap-1 overflow-x-auto overflow-y-hidden",
                )}
                data-tab-container
                onWheel={(e) => {
                  const container = e.currentTarget;
                  if (!container) return;

                  if (orientation === "vertical") {
                    container.scrollTop += e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  } else {
                    const deltaX = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                    container.scrollLeft += deltaX;
                  }
                  e.preventDefault();
                }}
              >
                {regularTerminals.map((terminal) => {
                  const index = sortedTerminals.findIndex((item) => item.id === terminal.id);

                  return (
                    <SortableTerminalTab
                      key={terminal.id}
                      id={terminal.id}
                      orientation={orientation}
                      tabRef={(el) => {
                        tabRefs.current[index] = el;
                      }}
                      disabled={editingTerminalId === terminal.id}
                    >
                      <TerminalTabBarItem
                        terminal={terminal}
                        displayName={getTerminalDisplayName(terminal)}
                        orientation={orientation}
                        isActive={terminal.id === activeTerminalId}
                        isDraggedTab={terminal.id === draggedTerminalId}
                        showDropIndicatorBefore={false}
                        tabRef={() => {}}
                        onClick={() => onTabClick(terminal.id)}
                        onContextMenu={(e) => handleContextMenu(e, terminal)}
                        onKeyDown={handleKeyDown}
                        handleTabClose={handleTabCloseWrapper}
                        handleTabPin={handleTabPin}
                        isEditing={editingTerminalId === terminal.id}
                        editingName={editingName}
                        onEditingNameChange={setEditingName}
                        onRenameSubmit={commitRename}
                        onRenameCancel={cancelRename}
                        onRenameBlur={handleRenameBlur}
                      />
                    </SortableTerminalTab>
                  );
                })}
              </div>
            </div>
          </SortableContext>

          {/* Horizontal mode - Action buttons on the right */}
          {orientation === "horizontal" && terminalToolbarActions}

          <DragOverlay dropAnimation={null}>
            {draggedTerminal ? (
              <div className="font-sans ui-text-sm flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/95 px-2 py-1.5 opacity-95 shadow-[var(--shadow-drag)]">
                <span className="shrink-0">
                  <TerminalIcon className="text-text-lighter" />
                </span>
                {draggedTerminal.isPinned && <Pin className="shrink-0 fill-current text-accent" />}
                <span className="max-w-[220px] truncate">
                  {getTerminalDisplayName(draggedTerminal)}
                </span>
              </div>
            ) : null}
          </DragOverlay>

          {/* Resize handle for vertical sidebar */}
          {orientation === "vertical" && (
            <div
              className={cn(
                "absolute top-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60",
                tabSidebarPosition === "right" ? "left-0" : "right-0",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = tabSidebarWidth;
                const directionMultiplier = tabSidebarPosition === "right" ? -1 : 1;

                const onMouseMove = (ev: MouseEvent) => {
                  setTabSidebarWidth(startWidth + (ev.clientX - startX) * directionMultiplier);
                };
                const onMouseUp = () => {
                  document.removeEventListener("mousemove", onMouseMove);
                  document.removeEventListener("mouseup", onMouseUp);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };

                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
              }}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize terminal sidebar"
            />
          )}
        </div>
      </DndContext>

      {createPortal(
        <>
          <TerminalTabContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            terminal={contextMenu.terminal}
            onClose={closeContextMenu}
            onPin={(terminalId) => {
              onTabPin?.(terminalId);
            }}
            onCloseTab={(terminalId) => {
              onTabClose(terminalId, {} as React.MouseEvent);
            }}
            onCloseOthers={onCloseOtherTabs || (() => {})}
            onCloseAll={onCloseAllTabs || (() => {})}
            onCloseToRight={onCloseTabsToRight || (() => {})}
            onClear={(terminalId) => {
              const session = useTerminalStore.getState().getSession(terminalId);
              if (session?.ref?.current) {
                session.ref.current.clear();
              }
            }}
            onDuplicate={(terminalId) => {
              const terminal = terminals.find((t) => t.id === terminalId);
              if (terminal) {
                onTabCreate?.(terminal.currentDirectory, terminal.shell, terminal.profileId);
              }
            }}
            onRename={(terminalId) => {
              startRename(terminalId);
            }}
            onExport={async (terminalId) => {
              const session = useTerminalStore.getState().getSession(terminalId);
              const terminal = terminals.find((t) => t.id === terminalId);
              if (session?.ref?.current && terminal) {
                try {
                  const content = session.ref.current.serialize();
                  if (!content) {
                    console.warn("No terminal content to export");
                    return;
                  }

                  const defaultFileName = `${terminal.name.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.txt`;
                  const filePath = await save({
                    defaultPath: defaultFileName,
                    filters: [
                      {
                        name: "Text Files",
                        extensions: ["txt"],
                      },
                      {
                        name: "All Files",
                        extensions: ["*"],
                      },
                    ],
                  });

                  if (filePath) {
                    await writeTextFile(filePath, content);
                    console.log(`Terminal output exported to: ${filePath}`);
                  }
                } catch (error) {
                  console.error("Failed to export terminal output:", error);
                }
              }
            }}
          />
          <ToolbarContextMenu
            isOpen={toolbarContextMenu.isOpen}
            position={toolbarContextMenu.position}
            onClose={closeToolbarContextMenu}
            currentMode={widthMode}
            currentLayout={tabLayout}
            currentSidebarPosition={tabSidebarPosition}
            onModeChange={setWidthMode}
            onLayoutChange={setTabLayout}
            onSidebarPositionChange={setTabSidebarPosition}
            onNewTerminal={onNewTerminal}
            onSearchTerminal={onSearchTerminal}
            onNextTerminal={onNextTerminal}
            onPrevTerminal={onPrevTerminal}
            onFullScreen={onFullScreen}
            isFullScreen={isFullScreen}
          />
          <Dropdown
            isOpen={profileMenu.isOpen}
            point={profileMenu.position}
            onClose={closeProfileMenu}
            className="w-[220px]"
          >
            <div className="font-sans ui-text-sm px-2.5 py-1 text-text-lighter">New Terminal</div>
            <div className="my-0.5 border-border/70 border-t" />
            <MenuItemsList items={profileMenuItems} onItemSelect={closeProfileMenu} />
          </Dropdown>
        </>,
        document.body,
      )}
    </>
  );
};

interface SortableTerminalTabProps {
  id: string;
  orientation: TerminalTabLayout;
  disabled: boolean;
  children: ReactNode;
  tabRef: (element: HTMLDivElement | null) => void;
}

function SortableTerminalTab({
  id,
  orientation,
  disabled,
  children,
  tabRef,
}: SortableTerminalTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
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
      className={cn(
        "relative",
        orientation === "vertical" ? "w-full" : "shrink-0",
        !disabled && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "z-10 opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export default TerminalTabBar;

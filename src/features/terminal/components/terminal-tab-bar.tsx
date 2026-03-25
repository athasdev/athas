import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlignCenter,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Maximize,
  Maximize2,
  Minimize2,
  Pin,
  Plus,
  Search,
  SplitSquareHorizontal,
  Terminal as TerminalIcon,
  PanelLeft,
  PanelRight,
  Rows3,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles-store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells-store";
import {
  type TerminalTabLayout,
  type TerminalTabSidebarPosition,
  type TerminalWidthMode,
  useTerminalStore,
} from "@/features/terminal/stores/terminal-store";
import type { Terminal } from "@/features/terminal/types/terminal";
import { getAllTerminalProfiles } from "@/features/terminal/utils/terminal-profiles";
import { Dropdown, dropdownItemClassName, MenuItemsList, type MenuItem } from "@/ui/dropdown";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
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
  onSplitView?: () => void;
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
  onSplitView,
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
    ...(onSplitView
      ? [
          {
            id: "toggle-split-view",
            label: "Toggle Split View",
            icon: <SplitSquareHorizontal />,
            onClick: onSplitView,
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
      <div className="ui-font ui-text-sm px-2.5 py-1 text-text-lighter">Terminal Width</div>
      <MenuItemsList items={modeItems} onItemSelect={onClose} />
      <div className="my-0.5 border-border/70 border-t" />
      <div className="ui-font ui-text-sm px-2.5 py-1 text-text-lighter">Tab Layout</div>
      <MenuItemsList items={layoutItems} onItemSelect={onClose} />
      {currentLayout === "vertical" && (
        <>
          <div className="my-0.5 border-border/70 border-t" />
          <div className="ui-font ui-text-sm px-2.5 py-1 text-text-lighter">Tab Position</div>
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
  onSplitView?: () => void;
  onSearchTerminal?: () => void;
  onNextTerminal?: () => void;
  onPrevTerminal?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
  isSplitView?: boolean;
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
  onSplitView,
  onSearchTerminal,
  onNextTerminal,
  onPrevTerminal,
  onFullScreen,
  isFullScreen = false,
  isSplitView = false,
  orientation = "horizontal",
}: TerminalTabBarProps) => {
  const renameStartedAtRef = useRef<number>(0);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
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

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [profileMenu, setProfileMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  useEffect(() => {
    void useTerminalShellsStore.getState().actions.loadShells();
  }, []);

  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
      return;
    }

    // Click the tab immediately (like project tabs pattern)
    const terminal = sortedTerminals[index];
    if (terminal) {
      onTabClick(terminal.id);
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
        const tabContainer = tabBarRef.current.querySelector("[data-tab-container]");
        if (tabContainer) {
          const tabElements = Array.from(tabContainer.children) as HTMLElement[];

          let newDropTarget: number | null = null;
          for (let i = 0; i < tabElements.length; i++) {
            const tabRect = tabElements[i].getBoundingClientRect();
            if (orientation === "vertical") {
              const tabY = tabRect.top - rect.top;
              const tabHeight = tabRect.height;
              if (y >= tabY && y <= tabY + tabHeight) {
                const relativeY = y - tabY;
                if (relativeY < tabHeight / 2) {
                  newDropTarget = i;
                } else {
                  newDropTarget = i + 1;
                }
                break;
              }
            } else {
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
          }

          if (orientation === "vertical" && newDropTarget === null) {
            if (y < 0) {
              newDropTarget = 0;
            } else if (y > rect.height) {
              newDropTarget = tabElements.length;
            }
          } else if (orientation !== "vertical" && newDropTarget === null) {
            if (x < 0) {
              newDropTarget = 0;
            } else if (x > rect.width) {
              newDropTarget = tabElements.length;
            }
          }

          // Clamp drop target to valid range
          if (newDropTarget !== null) {
            newDropTarget = Math.max(0, Math.min(tabElements.length, newDropTarget));
          }

          if (newDropTarget !== dropTarget) {
            setDropTarget(newDropTarget);
          }
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
          const movedTerminal = sortedTerminals[draggedIndex];
          if (movedTerminal) {
            onTabClick(movedTerminal.id);
          }
        }
      }
    }

    setIsDragging(false);
    setDraggedIndex(null);
    setDropTarget(null);
    setDragStartPosition(null);
    setDragCurrentPosition(null);
    setIsDraggedOutside(false);
  };

  const handleContextMenu = (e: React.MouseEvent, terminal: Terminal) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      terminal,
    });
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Drag functionality is handled via mouseDown/mouseMove
    e.preventDefault();
  };

  const handleDragEnd = () => {
    // Cleanup is handled in handleMouseUp
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
      setEditingName(terminal.name);
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
    return true;
  };
  const getTerminalDisplayName = (terminal: Terminal) => {
    const session = sessions.get(terminal.id);
    const title = session?.title?.trim();
    if (isUsefulTerminalTitle(title)) return title!;
    const commandLabel = getCommandLabel(terminal.initialCommand);
    if (commandLabel) return commandLabel;
    const dirLabel = getDirectoryLabel(session?.currentDirectory || terminal.currentDirectory);
    if (dirLabel) return dirLabel;
    return terminal.name;
  };
  const terminalProfiles = getAllTerminalProfiles(availableShells, customProfiles);
  const profileMenuItems: MenuItem[] = terminalProfiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    icon: <TerminalIcon className="text-text-lighter" />,
    onClick: () => {
      onNewTerminalWithProfile?.(profile.id);
      closeProfileMenu();
    },
  }));

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
          <span className="ui-font ui-text-sm text-text-lighter">No terminals</span>
        </div>
        {onNewTerminal && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="New Terminal (Cmd+T)" side="bottom">
              <Button
                onClick={onNewTerminal}
                variant="ghost"
                size="icon-sm"
                className="rounded-lg text-text-lighter"
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
                  size="icon-sm"
                  className="h-6 w-5 rounded-lg text-text-lighter"
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
      <div
        ref={tabBarRef}
        className={cn(
          orientation === "vertical"
            ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-primary-bg"
            : "relative flex min-h-8 items-center justify-between gap-1 overflow-hidden bg-primary-bg px-1.5 py-1",
          "[-ms-overflow-style:none] [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{
          scrollbarGutter: orientation === "vertical" ? undefined : "stable",
          ...(orientation === "vertical" ? { width: tabSidebarWidth } : {}),
        }}
        role="tablist"
        aria-label="Terminal tabs"
        onContextMenu={handleToolbarContextMenu}
      >
        {/* Tab list */}
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
              {pinnedTerminals.map((terminal, index) => {
                const isActive = terminal.id === activeTerminalId;
                const isDraggedTab = isDragging && draggedIndex === index;
                const showDropIndicatorBefore =
                  dropTarget === index && draggedIndex !== null && !isDraggedOutside;

                return (
                  <TerminalTabBarItem
                    key={terminal.id}
                    terminal={terminal}
                    displayName={getTerminalDisplayName(terminal)}
                    orientation={orientation}
                    isActive={isActive}
                    isDraggedTab={isDraggedTab}
                    showDropIndicatorBefore={showDropIndicatorBefore}
                    tabRef={(el) => {
                      tabRefs.current[index] = el;
                    }}
                    onMouseDown={(e) => handleMouseDown(e, index)}
                    onContextMenu={(e) => handleContextMenu(e, terminal)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
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
                );
              })}
            </div>
          )}

          <div
            className={cn(
              "scrollbar-hidden min-w-0 flex-1",
              orientation === "vertical"
                ? "flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden"
                : "flex gap-1 overflow-x-auto",
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
            {regularTerminals.map((terminal, regularIndex) => {
              const index = pinnedTerminals.length + regularIndex;
              const isActive = terminal.id === activeTerminalId;
              const isDraggedTab = isDragging && draggedIndex === index;
              const showDropIndicatorBefore =
                dropTarget === index && draggedIndex !== null && !isDraggedOutside;

              return (
                <TerminalTabBarItem
                  key={terminal.id}
                  terminal={terminal}
                  displayName={getTerminalDisplayName(terminal)}
                  orientation={orientation}
                  isActive={isActive}
                  isDraggedTab={isDraggedTab}
                  showDropIndicatorBefore={showDropIndicatorBefore}
                  tabRef={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  onMouseDown={(e) => handleMouseDown(e, index)}
                  onContextMenu={(e) => handleContextMenu(e, terminal)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
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
              );
            })}
            {dropTarget === sortedTerminals.length &&
              draggedIndex !== null &&
              !isDraggedOutside && (
                <div className="relative flex items-center">
                  <div
                    className={cn(
                      "absolute z-10 bg-accent",
                      orientation === "vertical"
                        ? "top-0 right-0 left-0 h-0.5"
                        : "top-0 bottom-0 w-0.5",
                    )}
                    style={orientation === "vertical" ? { width: "100%" } : { height: "100%" }}
                  />
                </div>
              )}
          </div>
        </div>

        {/* Horizontal mode - Action buttons on the right */}
        {orientation === "horizontal" && (
          <div className="flex shrink-0 items-center gap-1 px-1">
            {onSearchTerminal && (
              <Tooltip content="Find in Terminal (Cmd/Ctrl+F)" side="bottom">
                <Button
                  onClick={onSearchTerminal}
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-lg text-text-lighter"
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
                  size="icon-sm"
                  className="shrink-0 rounded-lg text-text-lighter"
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
                    size="icon-sm"
                    className="h-6 w-5 shrink-0 rounded-lg text-text-lighter"
                  >
                    <ChevronDown />
                  </Button>
                </Tooltip>
              )}
            </div>
            {onSplitView && (
              <Tooltip
                content={isSplitView ? "Exit Split View" : "Split Terminal View (Cmd+D)"}
                side="bottom"
              >
                <Button
                  onClick={onSplitView}
                  variant={isSplitView ? "secondary" : "ghost"}
                  size="icon-sm"
                  className={cn(
                    "shrink-0 rounded-lg",
                    isSplitView ? "text-text" : "text-text-lighter",
                  )}
                >
                  <SplitSquareHorizontal />
                </Button>
              </Tooltip>
            )}
            {onFullScreen && (
              <Tooltip
                content={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
                side="bottom"
              >
                <Button
                  onClick={onFullScreen}
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-lg text-text-lighter"
                >
                  {isFullScreen ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </Tooltip>
            )}
          </div>
        )}

        {/* Floating tab name while dragging */}
        {isDragging && draggedIndex !== null && dragCurrentPosition && (
          <div
            ref={(el) => {
              if (el && window) {
                const rect = el.getBoundingClientRect();
                el.style.left = `${dragCurrentPosition.x - rect.width / 2}px`;
                el.style.top = `${dragCurrentPosition.y - rect.height / 2}px`;
              }
            }}
            className="ui-font ui-text-sm fixed z-50 flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/95 px-2 py-1.5 shadow-sm"
            style={{
              opacity: 0.95,
              minWidth: 60,
              maxWidth: 220,
              whiteSpace: "nowrap",
              color: "var(--color-text)",
            }}
          >
            <span className="shrink-0">
              <TerminalIcon className="text-text-lighter" />
            </span>
            {sortedTerminals[draggedIndex].isPinned && (
              <Pin className="shrink-0 fill-current text-accent" />
            )}
            <span className="truncate">
              {getTerminalDisplayName(sortedTerminals[draggedIndex])}
            </span>
          </div>
        )}

        {/* Resize handle for vertical sidebar */}
        {orientation === "vertical" && (
          <div
            className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = tabSidebarWidth;

              const onMouseMove = (ev: MouseEvent) => {
                setTabSidebarWidth(startWidth + (ev.clientX - startX));
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
            onSplitView={onSplitView}
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
            <div className="ui-font ui-text-sm px-2.5 py-1 text-text-lighter">New Terminal</div>
            <div className="my-0.5 border-border/70 border-t" />
            <MenuItemsList items={profileMenuItems} onItemSelect={closeProfileMenu} />
          </Dropdown>
        </>,
        document.body,
      )}
    </>
  );
};

export default TerminalTabBar;

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlignCenter,
  ChevronDown,
  Maximize,
  Maximize2,
  Minimize2,
  Pin,
  Plus,
  Search,
  SplitSquareHorizontal,
  Terminal as TerminalIcon,
} from "lucide-react";
import type React from "react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEventListener, useOnClickOutside } from "usehooks-ts";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles-store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells-store";
import {
  type TerminalWidthMode,
  useTerminalStore,
} from "@/features/terminal/stores/terminal-store";
import type { Terminal } from "@/features/terminal/types/terminal";
import { getAllTerminalProfiles } from "@/features/terminal/utils/terminal-profiles";
import { MenuItemsList, MenuPopover, type MenuItem } from "@/ui/menu";
import { cn } from "@/utils/cn";
import Tooltip from "../../../ui/tooltip";
import TerminalTabBarItem from "./terminal-tab-bar-item";
import TerminalTabContextMenu from "./terminal-tab-context-menu";

interface ToolbarContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  currentMode: TerminalWidthMode;
  onModeChange: (mode: TerminalWidthMode) => void;
}

const ToolbarContextMenu = ({
  isOpen,
  position,
  onClose,
  currentMode,
  onModeChange,
}: ToolbarContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(document);

  useOnClickOutside(menuRef as RefObject<HTMLElement>, () => {
    onClose();
  });

  useEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    documentRef,
  );

  if (!isOpen) return null;

  const modes: { value: TerminalWidthMode; label: string; icon: React.ReactNode }[] = [
    { value: "full", label: "Full Width", icon: <Maximize size={12} /> },
    { value: "editor", label: "Editor Width", icon: <AlignCenter size={12} /> },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[10040] min-w-[180px] select-none rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{ left: position.x, top: position.y }}
    >
      <div className="ui-font px-2.5 py-1 text-[10px] text-text-lighter">Terminal Width</div>
      <div className="my-0.5 border-border/70 border-t" />
      {modes.map((mode) => (
        <button
          key={mode.value}
          className={cn(
            "ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover",
            currentMode === mode.value && "bg-selected",
          )}
          onClick={() => {
            onModeChange(mode.value);
            onClose();
          }}
        >
          {mode.icon}
          {mode.label}
        </button>
      ))}
    </div>
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
  onFullScreen?: () => void;
  isFullScreen?: boolean;
  isSplitView?: boolean;
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
  onFullScreen,
  isFullScreen = false,
  isSplitView = false,
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
  const customProfiles = useTerminalProfilesStore.use.profiles();
  const availableShells = useTerminalShellsStore.use.shells();
  const loadShells = useTerminalShellsStore.use.actions().loadShells;

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [profileMenu, setProfileMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  useOnClickOutside(profileMenuRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && profileMenuButtonRef.current?.contains(target)) {
      return;
    }
    setProfileMenu({ isOpen: false, position: { x: 0, y: 0 } });
  });

  useEffect(() => {
    void loadShells();
  }, [loadShells]);

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
    if (
      (e.target as HTMLElement).closest("[data-tab-container]") ||
      (e.target as HTMLElement).closest("button")
    ) {
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
  const terminalProfiles = getAllTerminalProfiles(availableShells, customProfiles);
  const profileMenuItems: MenuItem[] = terminalProfiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    icon: <TerminalIcon size={12} className="text-text-lighter" />,
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
          <TerminalIcon size={10} className="text-text-lighter" />
          <span className="ui-font text-text-lighter text-xs">No terminals</span>
        </div>
        {onNewTerminal && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="New Terminal (Cmd+T)" side="bottom">
              <button
                onClick={onNewTerminal}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-lg border border-transparent",
                  "text-text-lighter text-xs transition-colors hover:border-border/70 hover:bg-hover",
                )}
              >
                <Plus size={9} />
              </button>
            </Tooltip>
            {onNewTerminalWithProfile && terminalProfiles.length > 1 && (
              <Tooltip content="Choose Terminal Profile" side="bottom">
                <button
                  ref={profileMenuButtonRef}
                  onClick={openProfileMenu}
                  className={cn(
                    "flex h-6 w-5 items-center justify-center rounded-lg border border-transparent",
                    "text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                  )}
                >
                  <ChevronDown size={10} />
                </button>
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
          "relative flex min-h-8 items-center justify-between gap-1 overflow-hidden px-1.5 py-1",
          "[-ms-overflow-style:none] [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{
          scrollbarGutter: "stable",
        }}
        role="tablist"
        aria-label="Terminal tabs"
        onContextMenu={handleToolbarContextMenu}
      >
        {/* Left side - Terminal tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {pinnedTerminals.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 pr-1">
              {pinnedTerminals.map((terminal, index) => {
                const isActive = terminal.id === activeTerminalId;
                const isDraggedTab = isDragging && draggedIndex === index;
                const showDropIndicatorBefore =
                  dropTarget === index && draggedIndex !== null && !isDraggedOutside;

                return (
                  <TerminalTabBarItem
                    key={terminal.id}
                    terminal={terminal}
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
            className="scrollbar-hidden flex min-w-0 flex-1 gap-1 overflow-x-auto"
            data-tab-container
            onWheel={(e) => {
              const container = e.currentTarget;
              if (!container) return;

              const deltaX = e.deltaX !== 0 ? e.deltaX : e.deltaY;
              container.scrollLeft += deltaX;
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
                    className="absolute top-0 bottom-0 z-10 w-0.5 bg-accent"
                    style={{ height: "100%" }}
                  />
                </div>
              )}
          </div>
        </div>

        {/* Right side - Action buttons */}
        <div className="flex shrink-0 items-center gap-1 px-1">
          {onSearchTerminal && (
            <Tooltip content="Find in Terminal (Cmd/Ctrl+F)" side="bottom">
              <button
                onClick={onSearchTerminal}
                className={cn(
                  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1",
                  "text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                )}
              >
                <Search size={12} />
              </button>
            </Tooltip>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content="New Terminal (Cmd+T)" side="bottom">
              <button
                onClick={onNewTerminal}
                className={cn(
                  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1",
                  "text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                )}
              >
                <Plus size={14} />
              </button>
            </Tooltip>
            {onNewTerminalWithProfile && terminalProfiles.length > 1 && (
              <Tooltip content="Choose Terminal Profile" side="bottom">
                <button
                  ref={profileMenuButtonRef}
                  onClick={openProfileMenu}
                  className={cn(
                    "flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1",
                    "text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                  )}
                >
                  <ChevronDown size={11} />
                </button>
              </Tooltip>
            )}
          </div>
          {/* Split View Button */}
          {onSplitView && (
            <Tooltip
              content={isSplitView ? "Exit Split View" : "Split Terminal View (Cmd+D)"}
              side="bottom"
            >
              <button
                onClick={onSplitView}
                className={cn(
                  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border p-1",
                  isSplitView
                    ? "border-border/80 bg-primary-bg text-text"
                    : "border-transparent text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                )}
              >
                <SplitSquareHorizontal size={12} />
              </button>
            </Tooltip>
          )}
          {/* Full Screen Button */}
          {onFullScreen && (
            <Tooltip
              content={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
              side="bottom"
            >
              <button
                onClick={onFullScreen}
                className={cn(
                  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-1",
                  "text-text-lighter transition-colors hover:border-border/70 hover:bg-hover",
                )}
              >
                {isFullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </Tooltip>
          )}
        </div>

        {/* Floating tab name while dragging */}
        {isDragging && draggedIndex !== null && dragCurrentPosition && (
          <div
            ref={(el) => {
              if (el && window) {
                // Center the floating tab on the cursor
                const rect = el.getBoundingClientRect();
                el.style.left = `${dragCurrentPosition.x - rect.width / 2}px`;
                el.style.top = `${dragCurrentPosition.y - rect.height / 2}px`;
              }
            }}
            className="ui-font fixed z-50 flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/95 px-2 py-1.5 text-xs shadow-sm"
            style={{
              opacity: 0.95,
              minWidth: 60,
              maxWidth: 220,
              whiteSpace: "nowrap",
              color: "var(--color-text)",
            }}
          >
            {/* Terminal Icon */}
            <span className="shrink-0">
              <TerminalIcon size={12} className="text-text-lighter" />
            </span>
            {/* Pin indicator */}
            {sortedTerminals[draggedIndex].isPinned && (
              <Pin size={8} className="shrink-0 fill-current text-accent" />
            )}
            <span className="truncate">{sortedTerminals[draggedIndex].name}</span>
          </div>
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
            onModeChange={setWidthMode}
          />
          <MenuPopover
            isOpen={profileMenu.isOpen}
            menuRef={profileMenuRef}
            className="w-[220px]"
            style={{ left: profileMenu.position.x, top: profileMenu.position.y }}
          >
            <div className="ui-font px-2.5 py-1 text-[10px] text-text-lighter">New Terminal</div>
            <div className="my-0.5 border-border/70 border-t" />
            <MenuItemsList items={profileMenuItems} onItemSelect={closeProfileMenu} />
          </MenuPopover>
        </>,
        document.body,
      )}
    </>
  );
};

export default TerminalTabBar;

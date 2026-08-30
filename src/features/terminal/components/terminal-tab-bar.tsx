import { type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  ArrowsOutIcon as Maximize2,
  ArrowsInIcon as Minimize2,
  PlusIcon as Plus,
  MagnifyingGlassIcon as Search,
  TerminalWindowIcon as TerminalIcon,
} from "@/ui/icons";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { getChromeNavigationIndex } from "@/features/layout/utils/chrome-keyboard";
import { activateBufferInPaneAndSync } from "@/features/panes/utils/pane-activation";
import { getOrCreatePaneDropTarget } from "@/features/panes/utils/pane-drop-actions";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { getAllTerminalProfiles } from "@/features/terminal/utils/terminal-profiles";
import { normalizeTerminalTitle } from "@/features/terminal/utils/terminal-title";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ContextMenuPopup, type ContextMenuAction } from "@/ui/context-menu";
import { Button } from "@/ui/button";
import { SortableTab, TabBarSurface, TabDndContext, useTabDragClickGuard } from "@/ui/tab-bar";
import {
  clearInternalTabDragData,
  resolveDropTarget,
  setInternalTabDragHover,
  setInternalTabDragData,
} from "@/features/tabs/utils/internal-tab-drag";
import { useUIState } from "@/features/window/stores/ui-state.store";
import TerminalTabBarItem from "./terminal-tab-bar-item";
import TerminalTabContextMenu from "./terminal-tab-context-menu";

interface ToolbarContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
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
  onNewTerminal,
  onSearchTerminal,
  onNextTerminal,
  onPrevTerminal,
  onFullScreen,
  isFullScreen,
}: ToolbarContextMenuProps) => {
  const actionItems: ContextMenuAction[] = [
    ...(onNewTerminal
      ? [
          {
            id: "new-terminal",
            label: "New Terminal",
            icon: <Plus weight="bold" />,
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
    <ContextMenuPopup
      isOpen={isOpen}
      point={position}
      groups={[{ id: "terminal-actions", items: actionItems }]}
      onClose={onClose}
    />
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
  onNewTerminal?: (profileId?: string) => void;
  onTabCreate?: (directory: string, shell?: string, profileId?: string) => void;
  onCloseOtherTabs?: (terminalId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTabsToRight?: (terminalId: string) => void;
  onSearchTerminal?: () => void;
  onNextTerminal?: () => void;
  onPrevTerminal?: () => void;
  onFullScreen?: () => void;
  isFullScreen?: boolean;
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
  onTabCreate,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onSearchTerminal,
  onNextTerminal,
  onPrevTerminal,
  onFullScreen,
  isFullScreen = false,
}: TerminalTabBarProps) => {
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

  const sessions = useTerminalStore((state) => state.sessions);
  const customProfiles = useTerminalProfilesStore.use.profiles();
  const availableShells = useTerminalShellsStore.use.shells();
  const { openTerminalBuffer } = useBufferStore.use.actions();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const { getClickCapture, releaseClickSuppression, suppressNextClick } = useTabDragClickGuard();

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

  const handleKeyDown = (e: React.KeyboardEvent, terminalId: string) => {
    const currentIndex = sortedTerminals.findIndex((terminal) => terminal.id === terminalId);
    const currentTerminal = sortedTerminals[currentIndex];
    if (!currentTerminal || currentIndex < 0) return;

    if (e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      startRename(terminalId);
      return;
    }

    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setContextMenu({
        isOpen: true,
        position: { x: rect.left + 8, y: rect.bottom + 4 },
        terminal: currentTerminal,
      });
      return;
    }

    const nextIndex = getChromeNavigationIndex(
      e.key,
      currentIndex,
      sortedTerminals.length,
      "horizontal",
    );
    if (nextIndex !== null) {
      const nextTerminal = sortedTerminals[nextIndex];
      if (!nextTerminal || nextIndex === currentIndex) return;

      e.preventDefault();
      onTabClick(nextTerminal.id);
      tabRefs.current[nextIndex]?.focus();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onTabClick(terminalId);
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && !currentTerminal.isPinned) {
      e.preventDefault();
      onTabClose(terminalId);
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
      onTabClick(terminalId);
      setEditingTerminalId(terminalId);
      setEditingName(getTerminalDisplayName(terminal));
    });
  };

  const cancelRename = () => {
    setEditingTerminalId(null);
    setEditingName("");
  };

  const commitRename = (nextName: string) => {
    if (!editingTerminalId) return;

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      cancelRename();
      return;
    }

    onTabRename?.(editingTerminalId, trimmedName);
    cancelRename();
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

  // Sort terminals: pinned tabs first, then regular tabs
  const sortedTerminals = [...terminals].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });
  const sortedTerminalIds = sortedTerminals.map((terminal) => terminal.id);
  const terminalProfiles = getAllTerminalProfiles(availableShells, customProfiles);
  const terminalToolbarActions = (
    <div className="flex h-8 shrink-0 items-center gap-1 pl-1">
      {onSearchTerminal && (
        <Button
          onClick={onSearchTerminal}
          variant="ghost"
          iconOnly
          tooltip="Find in Terminal"
          commandId="terminal.find"
          aria-label="Find in terminal"
        >
          <Search />
        </Button>
      )}
      {onNewTerminal && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="New Terminal"
                commandId="terminal.new"
                aria-label="New terminal"
              />
            }
          >
            <Plus weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {terminalProfiles.map((profile) => (
              <DropdownMenuItem key={profile.id} onClick={() => onNewTerminal(profile.id)}>
                {profile.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {onFullScreen && (
        <Button
          onClick={onFullScreen}
          variant="ghost"
          iconOnly
          tooltip={isFullScreen ? "Exit Full Screen" : "Full Screen Terminal"}
          commandId="workbench.toggleActivePaneFullscreen"
          aria-label={isFullScreen ? "Exit full screen terminal" : "Full screen terminal"}
        >
          {isFullScreen ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
    </div>
  );
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
    if (title === "Default Terminal") return false;
    if (title.length > 28) return false;
    if (title.includes("@")) return false;
    if (title.includes("/") || title.includes("\\")) return false;
    return true;
  };
  const getTerminalDisplayName = (terminal: Terminal) => {
    if (terminal.customName && terminal.name.trim()) return terminal.name;

    const session = sessions.get(terminal.id);
    const title = normalizeTerminalTitle(session?.title ?? "");
    if (title && isUsefulTerminalTitle(title)) return title;
    const commandLabel = getCommandLabel(terminal.initialCommand);
    if (commandLabel) return commandLabel;
    const dirLabel = getDirectoryLabel(session?.currentDirectory || terminal.currentDirectory);
    if (dirLabel) return dirLabel;
    return terminal.name;
  };
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

  const resetDrag = () => {
    setDraggedTerminalId(null);
    dragPointRef.current = null;
    pointerPointRef.current = null;
    clearInternalTabDragData();
    releaseClickSuppression();
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
      shell: terminal.shell,
      initialCommand: terminal.initialCommand,
      currentDirectory: terminal.currentDirectory,
      remoteConnectionId: terminal.remoteConnectionId,
    });
    suppressNextClick(terminal.id);
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
        shell: terminal.shell,
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
          className="scrollbar-none justify-between overscroll-x-contain"
          role="tablist"
          aria-label="Terminal tabs"
          onContextMenu={handleToolbarContextMenu}
        >
          {/* Tab list */}
          <SortableContext items={sortedTerminalIds} strategy={horizontalListSortingStrategy}>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
              {terminals.length === 0 && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <TerminalIcon className="text-subtle-foreground" />
                  <span className="font-sans ui-text-sm text-subtle-foreground">No terminals</span>
                </div>
              )}
              {pinnedTerminals.length > 0 && (
                <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
                  {pinnedTerminals.map((terminal) => {
                    const index = sortedTerminals.findIndex((item) => item.id === terminal.id);

                    return (
                      <SortableTab
                        key={terminal.id}
                        id={terminal.id}
                        tabRef={(el) => {
                          tabRefs.current[index] = el;
                        }}
                        disabled={editingTerminalId === terminal.id}
                        onClickCapture={getClickCapture(terminal.id)}
                      >
                        {({ isDragging }) => (
                          <TerminalTabBarItem
                            terminal={terminal}
                            displayName={getTerminalDisplayName(terminal)}
                            isActive={terminal.id === activeTerminalId}
                            isDraggedTab={isDragging}
                            showDropIndicatorBefore={false}
                            tabRef={() => {}}
                            onClick={() => onTabClick(terminal.id)}
                            onContextMenu={(e) => handleContextMenu(e, terminal)}
                            onKeyDown={(event) => handleKeyDown(event, terminal.id)}
                            handleTabClose={handleTabCloseWrapper}
                            handleTabPin={handleTabPin}
                            isEditing={editingTerminalId === terminal.id}
                            editingName={editingName}
                            onEditingNameChange={setEditingName}
                            onRenameSubmit={commitRename}
                            onRenameCancel={cancelRename}
                          />
                        )}
                      </SortableTab>
                    );
                  })}
                </div>
              )}

              <div
                className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
                data-tab-container
                onWheel={(e) => {
                  const container = e.currentTarget;
                  if (!container) return;

                  const deltaX = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                  container.scrollLeft += deltaX;
                  e.preventDefault();
                }}
              >
                {regularTerminals.map((terminal) => {
                  const index = sortedTerminals.findIndex((item) => item.id === terminal.id);

                  return (
                    <SortableTab
                      key={terminal.id}
                      id={terminal.id}
                      tabRef={(el) => {
                        tabRefs.current[index] = el;
                      }}
                      disabled={editingTerminalId === terminal.id}
                      onClickCapture={getClickCapture(terminal.id)}
                    >
                      {({ isDragging }) => (
                        <TerminalTabBarItem
                          terminal={terminal}
                          displayName={getTerminalDisplayName(terminal)}
                          isActive={terminal.id === activeTerminalId}
                          isDraggedTab={isDragging}
                          showDropIndicatorBefore={false}
                          tabRef={() => {}}
                          onClick={() => onTabClick(terminal.id)}
                          onContextMenu={(e) => handleContextMenu(e, terminal)}
                          onKeyDown={(event) => handleKeyDown(event, terminal.id)}
                          handleTabClose={handleTabCloseWrapper}
                          handleTabPin={handleTabPin}
                          isEditing={editingTerminalId === terminal.id}
                          editingName={editingName}
                          onEditingNameChange={setEditingName}
                          onRenameSubmit={commitRename}
                          onRenameCancel={cancelRename}
                        />
                      )}
                    </SortableTab>
                  );
                })}
              </div>
            </div>
          </SortableContext>

          {terminalToolbarActions}
        </TabBarSurface>
      </TabDndContext>

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
              const session = useTerminalStore.getState().actions.getSession(terminalId);
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
              const session = useTerminalStore.getState().actions.getSession(terminalId);
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
            onNewTerminal={onNewTerminal}
            onSearchTerminal={onSearchTerminal}
            onNextTerminal={onNextTerminal}
            onPrevTerminal={onPrevTerminal}
            onFullScreen={onFullScreen}
            isFullScreen={isFullScreen}
          />
        </>,
        document.body,
      )}
    </>
  );
};

export default TerminalTabBar;

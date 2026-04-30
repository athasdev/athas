import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowSquareOut, CornersIn, CornersOut, List, Minus, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { HeaderTrailingItemId } from "@/features/layout/config/item-order";
import { SidebarPaneSelector } from "@/features/layout/components/sidebar/sidebar-pane-selector";
import {
  resolveSidebarPaneClick,
  type SidebarView,
} from "@/features/layout/utils/sidebar-pane-utils";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { AccountMenu } from "./account-menu";
import { NotificationsMenu } from "./notifications-menu";
import ProjectTabs from "./project-tabs";
import RunActionsButton from "./run-actions-button";
import WindowTitleDisplay from "./window-title-display";
import CustomMenuBar from "./menu-bar/window-menu-bar";

interface CustomTitleBarProps {
  title?: string;
  showMinimal?: boolean;
}

type HeaderItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

const CHROME_ICON_CLASS_NAME = "size-4";
const TITLE_BAR_CONTROL_GROUP_CLASS_NAME =
  "pointer-events-auto border-transparent bg-transparent p-0";
const TITLE_BAR_ICON_BUTTON_CLASS_NAME =
  "h-6 w-7 rounded-md border-0 bg-transparent text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-md";

function orderHeaderItems<T extends string>(items: Array<HeaderItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is HeaderItem<T> => Boolean(item));
  const missingItems = items.filter((item) => !orderedIds.includes(item.id));
  return [...orderedItems, ...missingItems];
}

const CustomTitleBar = ({ showMinimal = false }: CustomTitleBarProps) => {
  const { settings } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const {
    isGitViewActive,
    isGitHubPRsViewActive,
    activeSidebarView,
    isSidebarVisible,
    setActiveView,
    setIsSidebarVisible,
    setIsProjectPickerVisible,
  } = useUIState();
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const titleBarContextMenu = useContextMenu();

  const isMacOS = IS_MAC;
  const isWindows = IS_WINDOWS;
  const showCustomWindowControls = !isMacOS;
  const shouldUseNativeMenuBar = !isWindows && settings.nativeMenuBar;
  const titleBarProjectMode = settings.titleBarProjectMode;
  const showTopSidebarTabs = settings.sidebarTabsPosition === "top";
  useEffect(() => {
    const initWindow = async () => {
      const window = getCurrentWindow();
      setCurrentWindow(window);

      const syncWindowState = async () => {
        try {
          const [maximized, fullscreen] = await Promise.all([
            window.isMaximized(),
            window.isFullscreen(),
          ]);
          setIsMaximized(maximized);
          setIsFullscreen(fullscreen);
        } catch (error) {
          console.error("Error checking window state:", error);
        }
      };

      try {
        await syncWindowState();
        const unlistenResize = await window.onResized(() => {
          void syncWindowState();
        });
        const unlistenFocus = await window.onFocusChanged(() => {
          void syncWindowState();
        });

        return () => {
          unlistenResize();
          unlistenFocus();
        };
      } catch (error) {
        console.error("Error subscribing to window state:", error);
      }
    };

    let cleanup: (() => void) | void;
    void initWindow().then((dispose) => {
      cleanup = dispose;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await currentWindow?.minimize();
    } catch (error) {
      console.error("Error minimizing window:", error);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await currentWindow?.toggleMaximize();
      const maximized = await currentWindow?.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error("Error toggling maximize:", error);
    }
  };

  const handleClose = async () => {
    try {
      await currentWindow?.close();
    } catch (error) {
      console.error("Error closing window:", error);
    }
  };

  const handleSidebarViewChange = (view: SidebarView) => {
    const { nextIsSidebarVisible, nextView } = resolveSidebarPaneClick(
      {
        isSidebarVisible,
        isGitViewActive,
        isGitHubPRsViewActive,
      },
      view,
    );

    setActiveView(nextView);
    setIsSidebarVisible(nextIsSidebarVisible);
  };

  const handleTitleBarContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const interactiveTarget = target.closest(
      "button, a, input, textarea, select, [role='tab'], [data-title-bar-project-tabs='true'], [contenteditable='true']",
    );

    if (interactiveTarget) {
      return;
    }

    titleBarContextMenu.open(e);
  };

  const handleOpenFolderInNewWindow = async () => {
    const selected = await openFolder();
    if (!selected) return;

    await createAppWindow({
      path: selected,
      isDirectory: true,
    });
  };

  const titleBarContextMenuItems: ContextMenuItem[] = [
    {
      id: "new-window",
      label: "New Window",
      icon: <ArrowSquareOut weight="duotone" />,
      onClick: () => {
        void createAppWindow();
      },
    },
    {
      id: "add-project",
      label: "Add Project",
      onClick: () => setIsProjectPickerVisible(true),
    },
    {
      id: "open-project",
      label: "Open Folder",
      onClick: () => {
        void handleOpenFolder();
      },
    },
    {
      id: "open-project-new-window",
      label: "Open Folder in New Window",
      onClick: () => {
        void handleOpenFolderInNewWindow();
      },
    },
    ...(projectTabs.length > 0
      ? [
          { id: "sep-projects", label: "", separator: true, onClick: () => {} },
          {
            id: "close-all-projects",
            label: "Close All Projects",
            onClick: () => {
              useWorkspaceTabsStore.getState().closeAllProjectTabs();
            },
          },
        ]
      : []),
  ];

  const titleBarContextMenuPortal = createPortal(
    <ContextMenu
      isOpen={titleBarContextMenu.isOpen}
      position={titleBarContextMenu.position}
      items={titleBarContextMenuItems}
      onClose={titleBarContextMenu.close}
    />,
    document.body,
  );

  const menuItem = !shouldUseNativeMenuBar ? (
    settings.compactMenuBar ? (
      <div className="relative">
        <Tooltip content="Menu" side="bottom">
          <TabsList variant="segmented" className={TITLE_BAR_CONTROL_GROUP_CLASS_NAME}>
            <Button
              onClick={() => {
                setMenuBarActiveMenu("File");
              }}
              variant="ghost"
              size="icon-sm"
              className={cn(
                TITLE_BAR_ICON_BUTTON_CLASS_NAME,
                menuBarActiveMenu && "bg-hover/70 text-text",
              )}
              aria-label="Menu"
            >
              <List className={CHROME_ICON_CLASS_NAME} weight="duotone" />
            </Button>
          </TabsList>
        </Tooltip>
        <CustomMenuBar
          activeMenu={menuBarActiveMenu}
          setActiveMenu={setMenuBarActiveMenu}
          compactFloating
        />
      </div>
    ) : (
      <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
    )
  ) : null;

  const headerTrailingItems: Array<HeaderItem<HeaderTrailingItemId>> = [
    { id: "run-actions", label: "Run actions", content: <RunActionsButton /> },
    {
      id: "notifications",
      label: "Notifications",
      content: <NotificationsMenu />,
    },
    {
      id: "account",
      label: "Account",
      content: <AccountMenu className={!isMacOS ? "mr-1" : undefined} />,
    },
  ];

  if (showMinimal) {
    return (
      <div
        data-tauri-drag-region
        className={`relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-8" : "h-8"
        } bg-secondary-bg px-2`}
      >
        <div className="flex-1" />

        {showCustomWindowControls && (
          <div className="flex items-center">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="secondary"
                size="icon-md"
                className="pointer-events-auto"
              >
                <Minus className="size-4 text-text-lighter" weight="bold" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="secondary"
                size="icon-md"
                className="pointer-events-auto"
              >
                {isMaximized ? (
                  <CornersIn className="size-4 text-text-lighter" weight="duotone" />
                ) : (
                  <CornersOut className="size-4 text-text-lighter" weight="duotone" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                size="icon-md"
                className="pointer-events-auto group"
              >
                <X className="size-4 text-text-lighter group-hover:text-white" weight="bold" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    );
  }

  // Full mode with custom controls
  if (isMacOS) {
    return (
      <div
        data-tauri-drag-region
        onContextMenu={handleTitleBarContextMenu}
        className={cn(
          "relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg pr-2",
          isFullscreen ? "pl-2" : "pl-[94px]",
        )}
      >
        {/* Left side: keep clear of traffic lights */}
        <div className="pointer-events-auto flex h-8 min-w-0 items-center">
          {menuItem}
          {showTopSidebarTabs ? (
            <SidebarPaneSelector
              activeSidebarView={activeSidebarView}
              isGitViewActive={isGitViewActive}
              isGitHubPRsViewActive={isGitHubPRsViewActive}
              coreFeatures={settings.coreFeatures}
              onViewChange={handleSidebarViewChange}
              onSearchClick={() => openGlobalSearchBuffer()}
              compact
            />
          ) : null}
        </div>

        {/* Center - Project tabs for macOS */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-8 justify-center">
          <div
            data-title-bar-project-tabs="true"
            className="pointer-events-auto flex h-8 items-center"
          >
            {titleBarProjectMode === "window" ? <WindowTitleDisplay /> : <ProjectTabs />}
          </div>
        </div>

        {/* Account menu */}
        <div className="flex h-8 items-center">
          <div className="flex items-center gap-1">
            {orderHeaderItems(headerTrailingItems, settings.headerTrailingItemsOrder).map(
              (item) => (
                <div key={item.id}>{item.content}</div>
              ),
            )}
          </div>
        </div>
        {titleBarContextMenuPortal}
      </div>
    );
  }

  // Windows/Linux full title bar
  return (
    <div
      data-tauri-drag-region
      onContextMenu={handleTitleBarContextMenu}
      className="relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg px-2"
    >
      {/* Left side */}
      <div data-tauri-drag-region className="flex flex-1 items-center">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-2">
            {menuItem}
            {showTopSidebarTabs ? (
              <SidebarPaneSelector
                activeSidebarView={activeSidebarView}
                isGitViewActive={isGitViewActive}
                isGitHubPRsViewActive={isGitHubPRsViewActive}
                coreFeatures={settings.coreFeatures}
                onViewChange={handleSidebarViewChange}
                onSearchClick={() => openGlobalSearchBuffer()}
                compact
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Center - Project tabs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-8 justify-center">
        <div
          data-title-bar-project-tabs="true"
          className="pointer-events-auto flex h-8 items-center"
        >
          {titleBarProjectMode === "window" ? <WindowTitleDisplay /> : <ProjectTabs />}
        </div>
      </div>

      {/* Right side */}
      <div className="z-20 flex items-center">
        <div className="flex items-center gap-1">
          {orderHeaderItems(headerTrailingItems, settings.headerTrailingItemsOrder).map((item) => (
            <div key={item.id}>{item.content}</div>
          ))}
        </div>

        {showCustomWindowControls && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="secondary"
                size="icon-md"
                className="pointer-events-auto"
              >
                <Minus className="size-4 text-text-lighter" weight="bold" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="secondary"
                size="icon-md"
                className="pointer-events-auto"
              >
                {isMaximized ? (
                  <CornersIn className="size-4 text-text-lighter" weight="duotone" />
                ) : (
                  <CornersOut className="size-4 text-text-lighter" weight="duotone" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                size="icon-md"
                className="pointer-events-auto group"
              >
                <X className="size-4 text-text-lighter group-hover:text-white" weight="bold" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      {titleBarContextMenuPortal}
    </div>
  );
};

const CustomTitleBarWithSettings = (props: CustomTitleBarProps) => {
  const isSettingsDialogVisible = useUIState((state) => state.isSettingsDialogVisible);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);

  // Handle Cmd+, (Mac) or Ctrl+, (Windows/Linux) to open settings
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSettingsShortcut = event.key === "," && (IS_MAC ? event.metaKey : event.ctrlKey);

      if (isSettingsShortcut) {
        event.preventDefault();
        setIsSettingsDialogVisible(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setIsSettingsDialogVisible]);

  return (
    <>
      <CustomTitleBar {...props} />
      <SettingsDialog
        isOpen={isSettingsDialogVisible}
        onClose={() => setIsSettingsDialogVisible(false)}
      />
    </>
  );
};

export default CustomTitleBarWithSettings;

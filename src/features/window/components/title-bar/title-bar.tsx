import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import type { HeaderTrailingItemId } from "@/features/layout/config/item-order";
import { orderChromeItems, type ChromeItem } from "@/features/layout/utils/chrome-items";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useNativeWindowChrome } from "@/features/window/hooks/use-native-window-chrome";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import {
  FilesIcon,
  FolderOpenIcon,
  ListIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { AccountMenu } from "../account-menu";
import ProjectPicker from "../project-picker";
import RunActionsButton from "../run-actions-button";
import { WindowControls } from "./window-controls";
import WindowMenuBar from "../window-menu-bar";

interface TitleBarProps {
  title?: string;
  showMinimal?: boolean;
}

function placeHeaderItemsBeforeAccount(items: Array<ChromeItem<HeaderTrailingItemId>>) {
  const accountIndex = items.findIndex((item) => item.id === "account");
  if (accountIndex < 0) return items;

  const nextItems = [...items];
  for (const id of ["updates", "ai-chat"] as const) {
    const itemIndex = nextItems.findIndex((item) => item.id === id);
    const nextAccountIndex = nextItems.findIndex((item) => item.id === "account");
    if (itemIndex < 0 || nextAccountIndex < 0 || itemIndex === nextAccountIndex - 1) {
      continue;
    }

    const [item] = nextItems.splice(itemIndex, 1);
    const insertionIndex = nextItems.findIndex((candidate) => candidate.id === "account");
    nextItems.splice(insertionIndex, 0, item);
  }

  return nextItems;
}

const TitleBar = ({ showMinimal = false }: TitleBarProps) => {
  const nativeMenuBar = useSettingsStore((state) => state.settings.nativeMenuBar);
  const compactMenuBar = useSettingsStore((state) => state.settings.compactMenuBar);
  const isAIChatVisible = useSettingsStore((state) => state.settings.isAIChatVisible);
  const headerTrailingItemsOrder = useSettingsStore(
    (state) => state.settings.headerTrailingItemsOrder,
  );
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const isSidebarRailExpanded = useUIState((state) => state.isSidebarRailExpanded);
  const setIsSidebarRailExpanded = useUIState((state) => state.setIsSidebarRailExpanded);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const titleBarContextMenu = useContextMenu();

  const isMacOS = IS_MAC;
  const isWindows = IS_WINDOWS;
  const isLinux = IS_LINUX;
  const usesNativeWindowChrome = useNativeWindowChrome();
  const showAppWindowControls = !isMacOS && !usesNativeWindowChrome;
  const shouldUseNativeMenuBar = !isWindows && !isLinux && nativeMenuBar;
  const macTitleBarControlAlignment = isFullscreen ? undefined : "translate-y-[3px]";

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

  const handleTitleBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    const interactiveTarget = target.closest(
      "button, a, input, textarea, select, [role='tab'], [data-title-bar-project-tabs='true'], [contenteditable='true']",
    );

    if (interactiveTarget) return;

    void currentWindow?.startDragging().catch((error: unknown) => {
      console.error("Error starting window drag:", error);
    });
  };

  const handleOpenFolderInNewWindow = async () => {
    const selected = await openFolder();
    if (!selected) return;

    await createAppWindow({
      path: selected,
      isDirectory: true,
    });
  };

  const handleCloseAllProjects = useCallback(async () => {
    const tabsToClose = [...useWorkspaceTabsStore.getState().projectTabs];

    for (const tab of tabsToClose) {
      await closeProject(tab.id);
    }
  }, [closeProject]);

  const handleCompactMenuToggle = useCallback(() => {
    setMenuBarActiveMenu((activeMenu) => (activeMenu ? null : "File"));
  }, []);

  const titleBarContextMenuItems: ContextMenuItem[] = [
    {
      id: "new-window",
      label: "New Window",
      icon: <WindowExpandIcon />,
      onClick: () => {
        void createAppWindow();
      },
    },
    {
      id: "add-project",
      label: "Add Project",
      icon: <FilesIcon />,
      onClick: () => setIsProjectPickerVisible(true),
    },
    {
      id: "open-project",
      label: "Open Folder",
      icon: <FolderOpenIcon />,
      onClick: () => {
        void handleOpenFolder();
      },
    },
    {
      id: "open-project-new-window",
      label: "Open Folder in New Window",
      icon: <WindowExpandIcon />,
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
            icon: <TrashIcon />,
            onClick: () => {
              void handleCloseAllProjects();
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

  const menuItem =
    !isMacOS && !shouldUseNativeMenuBar ? (
      compactMenuBar ? (
        <div className="relative">
          <Tooltip content="Menu" side="bottom">
            <Button
              onClick={handleCompactMenuToggle}
              variant="ghost"
              size="icon-xs"
              chrome="icon"
              className={menuBarActiveMenu ? "bg-hover/70 text-text" : undefined}
              aria-label="Menu"
              aria-expanded={Boolean(menuBarActiveMenu)}
            >
              <ListIcon />
            </Button>
          </Tooltip>
          <WindowMenuBar
            activeMenu={menuBarActiveMenu}
            setActiveMenu={setMenuBarActiveMenu}
            compactFloating
          />
        </div>
      ) : (
        <WindowMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
      )
    ) : null;

  const sidebarToggle = (
    <Button
      type="button"
      variant="ghost"
      active={isSidebarRailExpanded}
      tooltip={isSidebarRailExpanded ? "Collapse Activity Bar" : "Expand Activity Bar"}
      tooltipSide="bottom"
      onClick={() => setIsSidebarRailExpanded(!isSidebarRailExpanded)}
      chrome="icon"
      aria-label={isSidebarRailExpanded ? "Collapse activity bar" : "Expand activity bar"}
      aria-pressed={isSidebarRailExpanded}
      size="icon-xs"
    >
      <SidebarSimpleIcon />
    </Button>
  );

  const headerTrailingItems: Array<ChromeItem<HeaderTrailingItemId>> = [
    { id: "run-actions", label: "Run actions", content: <RunActionsButton /> },
    { id: "updates", label: "App updates", content: <AppUpdateControl /> },
    {
      id: "ai-chat",
      label: "Agent",
      content: (
        <Button
          type="button"
          variant="ghost"
          active={isAIChatVisible}
          tooltip="Toggle Agent"
          tooltipSide="bottom"
          commandId="workbench.toggleAIChat"
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
          chrome="icon"
          aria-label="Toggle Agent"
          size="icon-xs"
        >
          <SparkleIcon />
        </Button>
      ),
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
        onMouseDown={handleTitleBarMouseDown}
        className="athas-title-bar relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg px-2"
      >
        <div className="flex-1" />

        {showAppWindowControls && (
          <WindowControls
            currentWindow={currentWindow}
            isMaximized={isMaximized}
            onMaximizedChange={setIsMaximized}
          />
        )}
      </div>
    );
  }

  if (isMacOS) {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={handleTitleBarMouseDown}
        onContextMenu={handleTitleBarContextMenu}
        className={cn(
          "athas-title-bar relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg pr-2",
          isFullscreen ? "pl-2" : "pl-[94px]",
        )}
      >
        <div
          className={cn(
            "pointer-events-auto flex h-8 min-w-0 items-center",
            macTitleBarControlAlignment,
          )}
        >
          {menuItem}
          {sidebarToggle}
        </div>

        <div className={cn("flex h-8 items-center", macTitleBarControlAlignment)}>
          <div className="flex items-center gap-1">
            {placeHeaderItemsBeforeAccount(
              orderChromeItems(headerTrailingItems, headerTrailingItemsOrder),
            ).map((item) =>
              item.content ? (
                <div key={item.id} className="flex min-h-6 items-center">
                  {item.content}
                </div>
              ) : null,
            )}
          </div>
        </div>
        {titleBarContextMenuPortal}
      </div>
    );
  }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleTitleBarMouseDown}
      onContextMenu={handleTitleBarContextMenu}
      className="athas-title-bar relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg px-2"
    >
      <div data-tauri-drag-region className="flex flex-1 items-center">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-1">
            {menuItem}
            {sidebarToggle}
          </div>
        </div>
      </div>
      <div className="z-20 flex items-center">
        <div className="flex items-center gap-1">
          {placeHeaderItemsBeforeAccount(
            orderChromeItems(headerTrailingItems, headerTrailingItemsOrder),
          ).map((item) =>
            item.content ? (
              <div key={item.id} className="flex min-h-6 items-center">
                {item.content}
              </div>
            ) : null,
          )}
        </div>

        {showAppWindowControls && (
          <WindowControls
            currentWindow={currentWindow}
            isMaximized={isMaximized}
            onMaximizedChange={setIsMaximized}
          />
        )}
      </div>
      {titleBarContextMenuPortal}
    </div>
  );
};

const TitleBarWithSettings = (props: TitleBarProps) => {
  const isSettingsDialogVisible = useUIState((state) => state.isSettingsDialogVisible);
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);

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
      <TitleBar {...props} />
      <SettingsDialog
        isOpen={isSettingsDialogVisible}
        onClose={() => setIsSettingsDialogVisible(false)}
      />
      {createPortal(
        <ProjectPicker
          isOpen={isProjectPickerVisible}
          onClose={() => setIsProjectPickerVisible(false)}
        />,
        document.body,
      )}
    </>
  );
};

export default TitleBarWithSettings;

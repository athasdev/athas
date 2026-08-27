import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { GitHubNotificationsMenu } from "@/features/github/components/github-notifications-menu";
import type { HeaderTrailingItemId } from "@/features/layout/config/item-order";
import { orderChromeItems, type ChromeItem } from "@/features/layout/utils/chrome-items";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useNativeWindowChrome } from "@/features/window/hooks/use-native-window-chrome";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ChromeBar, ChromeGroup } from "@/ui/chrome";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  FilesIcon,
  FolderOpenIcon,
  ListIcon,
  DotsThreeIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { Toggle } from "@/ui/toggle";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { AccountMenu } from "../account-menu";
import ProjectPicker from "../project-picker";
import { WindowControls } from "./window-controls";
import WindowMenuBar from "../window-menu-bar";

interface TitleBarProps {
  showMinimal?: boolean;
  activityBarExpanded?: boolean;
  onActivityBarExpandedChange?: (expanded: boolean) => void;
}

function placeAgentBeforeAccount(items: Array<ChromeItem<HeaderTrailingItemId>>) {
  const accountIndex = items.findIndex((item) => item.id === "account");
  if (accountIndex < 0) return items;

  const nextItems = [...items];
  const itemIndex = nextItems.findIndex((item) => item.id === "ai-chat");
  const nextAccountIndex = nextItems.findIndex((item) => item.id === "account");
  if (itemIndex < 0 || nextAccountIndex < 0 || itemIndex === nextAccountIndex - 1) {
    return nextItems;
  }

  const [item] = nextItems.splice(itemIndex, 1);
  const insertionIndex = nextItems.findIndex((candidate) => candidate.id === "account");
  nextItems.splice(insertionIndex, 0, item);

  return nextItems;
}

function TitleBarTrailingActions({ items }: { items: Array<ChromeItem<HeaderTrailingItemId>> }) {
  const notificationsRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<HTMLDivElement>(null);
  const activateFirstButton = (container: HTMLDivElement | null) => {
    container?.querySelector<HTMLButtonElement>("button")?.click();
  };

  return (
    <ChromeGroup gap="tight">
      <div ref={notificationsRef} className="max-[820px]:hidden">
        <GitHubNotificationsMenu />
      </div>
      <div ref={updateRef} className="max-[820px]:hidden">
        <AppUpdateControl />
      </div>
      <div className="hidden max-[820px]:block">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label="More toolbar actions" />}
          >
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem onClick={() => activateFirstButton(notificationsRef.current)}>
              GitHub Notifications
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => activateFirstButton(updateRef.current)}>
              Check for Updates
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {items.map((item) =>
        item.content ? (
          <div key={item.id} className="flex min-h-chrome-control items-center">
            {item.content}
          </div>
        ) : null,
      )}
    </ChromeGroup>
  );
}

const TitleBar = ({
  showMinimal = false,
  activityBarExpanded: controlledActivityBarExpanded,
  onActivityBarExpandedChange,
}: TitleBarProps) => {
  const nativeMenuBar = useSettingsStore((state) => state.settings.nativeMenuBar);
  const compactMenuBar = useSettingsStore((state) => state.settings.compactMenuBar);
  const isAIChatVisible = useSettingsStore((state) => state.settings.isAIChatVisible);
  const activityRailExpanded = useSettingsStore((state) => state.settings.activityRailExpanded);
  const effectiveActivityBarExpanded = controlledActivityBarExpanded ?? activityRailExpanded;
  const headerTrailingItemsOrder = useSettingsStore(
    (state) => state.settings.headerTrailingItemsOrder,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const openProjectPicker = useUIState((state) => state.openProjectPicker);

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isCompactMenuVisible, setIsCompactMenuVisible] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<TauriWindow | null>(null);

  const isMacOS = IS_MAC;
  const isWindows = IS_WINDOWS;
  const isLinux = IS_LINUX;
  const usesNativeWindowChrome = useNativeWindowChrome();
  const showAppWindowControls = !isMacOS && !usesNativeWindowChrome;
  const shouldUseNativeMenuBar = !isWindows && !isLinux && nativeMenuBar;

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
      "button, a, input, textarea, select, [role='tab'], [contenteditable='true']",
    );

    if (interactiveTarget) {
      e.preventDefault();
      return;
    }
  };

  const handleTitleBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    const interactiveTarget = target.closest(
      "button, a, input, textarea, select, [role='tab'], [contenteditable='true']",
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
    setMenuBarActiveMenu(null);
    setIsCompactMenuVisible((visible) => !visible);
  }, []);

  const handleCompactMenuClose = useCallback(() => {
    setMenuBarActiveMenu(null);
    setIsCompactMenuVisible(false);
  }, []);

  const titleBarContextMenuContent = (
    <ContextMenuContent>
      <ContextMenuItem onClick={() => void createAppWindow()}>
        <WindowExpandIcon />
        New Window
      </ContextMenuItem>
      <ContextMenuItem onClick={() => openProjectPicker()}>
        <FilesIcon />
        Add Project
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void handleOpenFolder()}>
        <FolderOpenIcon />
        Open Folder
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void handleOpenFolderInNewWindow()}>
        <WindowExpandIcon />
        Open Folder in New Window
      </ContextMenuItem>
      {projectTabs.length > 0 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void handleCloseAllProjects()}>
            <TrashIcon />
            Close All Projects
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
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
              className={isCompactMenuVisible ? "bg-accent/70 text-foreground" : undefined}
              aria-label="Menu"
              aria-expanded={isCompactMenuVisible}
            >
              <ListIcon />
            </Button>
          </Tooltip>
          {isCompactMenuVisible ? (
            <WindowMenuBar
              activeMenu={menuBarActiveMenu}
              setActiveMenu={setMenuBarActiveMenu}
              compactFloating
              onCompactClose={handleCompactMenuClose}
            />
          ) : null}
        </div>
      ) : (
        <WindowMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
      )
    ) : null;

  const sidebarToggle = (
    <Toggle
      type="button"
      pressed={effectiveActivityBarExpanded}
      tooltip={effectiveActivityBarExpanded ? "Collapse Activity Bar" : "Expand Activity Bar"}
      commandId="workbench.toggleActivitySidebar"
      tooltipSide="bottom"
      onPressedChange={(pressed) => {
        if (onActivityBarExpandedChange) onActivityBarExpandedChange(pressed);
        else void updateSetting("activityRailExpanded", pressed);
      }}
      aria-label={effectiveActivityBarExpanded ? "Collapse activity bar" : "Expand activity bar"}
      size="xs"
    >
      <SidebarSimpleIcon />
    </Toggle>
  );

  const headerTrailingItems: Array<ChromeItem<HeaderTrailingItemId>> = [
    { id: "run-actions", label: "Run actions", content: <RunActionsButton /> },
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
            useSettingsStore.getState().actions.toggleAIChatVisible();
          }}
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
  const orderedTrailingItems = placeAgentBeforeAccount(
    orderChromeItems(headerTrailingItems, headerTrailingItemsOrder),
  );

  if (showMinimal) {
    return (
      <ChromeBar
        region="title"
        role="toolbar"
        aria-label="Window toolbar"
        data-tauri-drag-region
        onMouseDown={handleTitleBarMouseDown}
        className="athas-title-bar relative z-50 justify-between select-none"
      >
        <ChromeGroup grow />

        {showAppWindowControls && (
          <WindowControls
            currentWindow={currentWindow}
            isMaximized={isMaximized}
            onMaximizedChange={setIsMaximized}
          />
        )}
      </ChromeBar>
    );
  }

  if (isMacOS) {
    return (
      <ContextMenu>
        <ContextMenuTrigger
          role="toolbar"
          aria-label="Window toolbar"
          onContextMenu={handleTitleBarContextMenu}
          className={cn(
            "athas-title-bar font-sans ui-text-chrome relative z-50 flex h-title-bar items-center justify-between gap-chrome bg-transparent pr-chrome-inline text-subtle-foreground",
            isFullscreen ? "pl-2" : "pl-title-bar-leading",
          )}
          data-tauri-drag-region
          onMouseDown={handleTitleBarMouseDown}
        >
          <ChromeGroup className="pointer-events-auto h-full">
            {menuItem}
            {sidebarToggle}
          </ChromeGroup>

          <ChromeGroup className="h-full">
            <TitleBarTrailingActions items={orderedTrailingItems} />
          </ChromeGroup>
        </ContextMenuTrigger>
        {titleBarContextMenuContent}
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        role="toolbar"
        aria-label="Window toolbar"
        data-tauri-drag-region
        onMouseDown={handleTitleBarMouseDown}
        onContextMenu={handleTitleBarContextMenu}
        className="athas-title-bar font-sans ui-text-chrome relative z-50 flex h-title-bar items-center justify-between gap-chrome bg-transparent px-chrome-inline text-subtle-foreground"
      >
        <ChromeGroup data-tauri-drag-region grow>
          <ChromeGroup className="pointer-events-auto">
            {menuItem}
            {sidebarToggle}
          </ChromeGroup>
        </ChromeGroup>
        <ChromeGroup className="z-20">
          <TitleBarTrailingActions items={orderedTrailingItems} />

          {showAppWindowControls && (
            <WindowControls
              currentWindow={currentWindow}
              isMaximized={isMaximized}
              onMaximizedChange={setIsMaximized}
            />
          )}
        </ChromeGroup>
      </ContextMenuTrigger>
      {titleBarContextMenuContent}
    </ContextMenu>
  );
};

const TitleBarWithOverlays = (props: TitleBarProps) => {
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const projectPickerInitialStep = useUIState((state) => state.projectPickerInitialStep);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);

  return (
    <>
      <TitleBar {...props} />
      {createPortal(
        isProjectPickerVisible ? (
          <ProjectPicker
            isOpen
            initialStep={projectPickerInitialStep}
            onClose={() => setIsProjectPickerVisible(false)}
          />
        ) : null,
        document.body,
      )}
    </>
  );
};

export default TitleBarWithOverlays;

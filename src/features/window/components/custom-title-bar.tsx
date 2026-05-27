import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowSquareOut,
  CornersIn,
  CornersOut,
  List,
  Minus,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { HeaderTrailingItemId } from "@/features/layout/config/item-order";
import { SidebarPaneSelector } from "@/features/layout/components/sidebar/sidebar-pane-selector";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import {
  chromeControl,
  chromeControlGroup,
  chromeIcon,
  chromeItemWrapper,
} from "@/features/layout/components/chrome-control-styles";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { useNativeWindowChrome } from "@/features/window/hooks/use-native-window-chrome";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { AccountMenu } from "./account-menu";
import ProjectPicker from "./project-picker";
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

function orderHeaderItems<T extends string>(items: Array<HeaderItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is HeaderItem<T> => Boolean(item));
  const missingItems = items.filter((item) => !orderedIds.includes(item.id));
  return [...orderedItems, ...missingItems];
}

function placeHeaderItemsBeforeAccount<T extends string>(items: Array<HeaderItem<T>>) {
  const accountIndex = items.findIndex((item) => item.id === "account");
  if (accountIndex < 0) return items;

  let nextItems = [...items];
  for (const id of ["ai-chat"] as const) {
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

const CustomTitleBar = ({ showMinimal = false }: CustomTitleBarProps) => {
  const { settings, updateSetting } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const { isGitViewActive, isGitHubPRsViewActive, activeSidebarView, setIsProjectPickerVisible } =
    useUIState();
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const { openSidebarView } = useSidebarPaneController();

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const titleBarContextMenu = useContextMenu();

  const isMacOS = IS_MAC;
  const isWindows = IS_WINDOWS;
  const usesNativeWindowChrome = useNativeWindowChrome();
  const showCustomWindowControls = !isMacOS && !usesNativeWindowChrome;
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
    openSidebarView(view, { triggerSide: "left" });
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
              void handleCloseAllProjects();
            },
          },
        ]
      : []),
    { id: "sep-layout", label: "", separator: true, onClick: () => {} },
    {
      id: "sidebar-left",
      label: "Move Sidebar Left",
      disabled: settings.sidebarPosition === "left",
      onClick: () => {
        void updateSetting("sidebarPosition", "left");
      },
    },
    {
      id: "sidebar-right",
      label: "Move Sidebar Right",
      disabled: settings.sidebarPosition === "right",
      onClick: () => {
        void updateSetting("sidebarPosition", "right");
      },
    },
    {
      id: "activity-tabs-top",
      label: "Show Activity Tabs in Title Bar",
      disabled: settings.sidebarTabsPosition === "top",
      onClick: () => {
        void updateSetting("sidebarTabsPosition", "top");
      },
    },
    {
      id: "activity-tabs-left",
      label: "Show Activity Tabs in Sidebar",
      disabled: settings.sidebarTabsPosition === "left",
      onClick: () => {
        void updateSetting("sidebarTabsPosition", "left");
      },
    },
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
      settings.compactMenuBar ? (
        <div className="relative">
          <Tooltip content="Menu" side="bottom">
            <TabsList variant="segmented" className={chromeControlGroup()}>
              <Button
                ref={menuButtonRef}
                onClick={handleCompactMenuToggle}
                variant="ghost"
                compact
                className={cn(chromeControl(), menuBarActiveMenu && "bg-hover/70 text-text")}
                aria-label="Menu"
                aria-expanded={Boolean(menuBarActiveMenu)}
              >
                <List className={chromeIcon()} weight="duotone" />
              </Button>
            </TabsList>
          </Tooltip>
          <CustomMenuBar
            activeMenu={menuBarActiveMenu}
            setActiveMenu={setMenuBarActiveMenu}
            compactFloating
            anchorRef={menuButtonRef}
          />
        </div>
      ) : (
        <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
      )
    ) : null;

  const headerTrailingItems: Array<HeaderItem<HeaderTrailingItemId>> = [
    { id: "run-actions", label: "Run actions", content: <RunActionsButton /> },
    {
      id: "ai-chat",
      label: "AI Chat",
      content: (
        <Button
          type="button"
          variant="ghost"
          active={settings.isAIChatVisible}
          tooltip="Toggle AI Chat"
          tooltipSide="bottom"
          commandId="workbench.toggleAIChat"
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
          className={chromeControl()}
          aria-label="Toggle AI Chat"
        >
          <Sparkle className={chromeIcon()} weight="duotone" />
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
        className={`athas-title-bar relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-8" : "h-8"
        } bg-secondary-bg px-2`}
      >
        <div className="flex-1" />

        {showCustomWindowControls && (
          <div className="flex items-center">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="ghost"
                className={cn("pointer-events-auto", chromeControl())}
                compact
              >
                <Minus weight="bold" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="ghost"
                className={cn("pointer-events-auto", chromeControl())}
                compact
              >
                {isMaximized ? <CornersIn weight="duotone" /> : <CornersOut weight="duotone" />}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                className={cn("pointer-events-auto group hover:text-white", chromeControl())}
                compact
              >
                <X weight="bold" />
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
          "athas-title-bar relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg pr-2",
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
            {placeHeaderItemsBeforeAccount(
              orderHeaderItems(headerTrailingItems, settings.headerTrailingItemsOrder),
            ).map((item) =>
              item.content ? (
                <div key={item.id} className={chromeItemWrapper()}>
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

  // Windows/Linux full title bar
  return (
    <div
      data-tauri-drag-region
      onContextMenu={handleTitleBarContextMenu}
      className="athas-title-bar relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg px-2"
    >
      {/* Left side */}
      <div data-tauri-drag-region className="flex flex-1 items-center">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-1">
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
          {placeHeaderItemsBeforeAccount(
            orderHeaderItems(headerTrailingItems, settings.headerTrailingItemsOrder),
          ).map((item) =>
            item.content ? (
              <div key={item.id} className={chromeItemWrapper()}>
                {item.content}
              </div>
            ) : null,
          )}
        </div>

        {showCustomWindowControls && (
          <div className="flex items-center gap-1">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="ghost"
                className={cn("pointer-events-auto", chromeControl())}
                compact
              >
                <Minus weight="bold" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="ghost"
                className={cn("pointer-events-auto", chromeControl())}
                compact
              >
                {isMaximized ? <CornersIn weight="duotone" /> : <CornersOut weight="duotone" />}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                className={cn("pointer-events-auto group hover:text-white", chromeControl())}
                compact
              >
                <X weight="bold" />
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
      <CustomTitleBar {...props} />
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

export default CustomTitleBarWithSettings;

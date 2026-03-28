import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, MenuIcon, Minimize2, Minus, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { SidebarPaneSelector } from "@/features/layout/components/sidebar/sidebar-pane-selector";
import {
  resolveSidebarPaneClick,
  type SidebarView,
} from "@/features/layout/components/sidebar/sidebar-pane-utils";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/store";
import { useContextMenu } from "@/hooks/use-context-menu";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC } from "@/utils/platform";
import { AccountMenu } from "./account-menu";
import ProjectTabs from "./project-tabs";
import RunActionsButton from "./run-actions-button";
import WindowTitleDisplay from "./window-title-display";
import CustomMenuBar from "./menu-bar/window-menu-bar";

interface CustomTitleBarProps {
  title?: string;
  showMinimal?: boolean;
}

const CustomTitleBar = ({ showMinimal = false }: CustomTitleBarProps) => {
  const { settings } = useSettingsStore();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const {
    isGitViewActive,
    isGitHubPRsViewActive,
    isSidebarVisible,
    setActiveView,
    setIsSidebarVisible,
    setIsGlobalSearchVisible,
    isGlobalSearchVisible,
    setIsProjectPickerVisible,
  } = useUIState();

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const titleBarContextMenu = useContextMenu();

  const isMacOS = IS_MAC;
  const isLinux = IS_LINUX;
  const titleBarProjectMode = settings.titleBarProjectMode;

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
      icon: <SquareArrowOutUpRight />,
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

  if (showMinimal) {
    return (
      <div
        data-tauri-drag-region
        className={`relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-8" : "h-8"
        } bg-secondary-bg px-2`}
      >
        <div className="flex-1" />

        {/* Window controls - only show on Linux */}
        {isLinux && (
          <div className="flex items-center">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="secondary"
                size="icon-sm"
                className="pointer-events-auto"
              >
                <Minus className="size-3.5 text-text-lighter" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="secondary"
                size="icon-sm"
                className="pointer-events-auto"
              >
                {isMaximized ? (
                  <Minimize2 className="size-3.5 text-text-lighter" />
                ) : (
                  <Maximize2 className="size-3.5 text-text-lighter" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                size="icon-sm"
                className="pointer-events-auto group"
              >
                <X className="size-3.5 text-text-lighter group-hover:text-white" />
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
          "relative z-50 flex h-8 select-none items-center justify-between bg-secondary-bg pr-3",
          isFullscreen ? "pl-2" : "pl-[94px]",
        )}
      >
        {/* Left side: keep clear of traffic lights */}
        <div className="pointer-events-auto flex h-8 min-w-0 items-center gap-1">
          {!settings.nativeMenuBar && !settings.compactMenuBar && (
            <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
          )}
          {!settings.nativeMenuBar && settings.compactMenuBar && (
            <div className="relative">
              <Tooltip content="Menu" side="bottom">
                <Button
                  onClick={() => {
                    setMenuBarActiveMenu("File");
                  }}
                  variant="secondary"
                  size="icon-sm"
                  className="pointer-events-auto"
                >
                  <MenuIcon />
                </Button>
              </Tooltip>
              <CustomMenuBar
                activeMenu={menuBarActiveMenu}
                setActiveMenu={setMenuBarActiveMenu}
                compactFloating
              />
            </div>
          )}
          <SidebarPaneSelector
            isGitViewActive={isGitViewActive}
            isGitHubPRsViewActive={isGitHubPRsViewActive}
            coreFeatures={settings.coreFeatures}
            onViewChange={handleSidebarViewChange}
            onSearchClick={() => setIsGlobalSearchVisible(!isGlobalSearchVisible)}
            compact
          />
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
        <div className="mr-1 flex h-8 items-center gap-1">
          <RunActionsButton />
          <AccountMenu iconSize={13} />
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
      <div data-tauri-drag-region className="flex flex-1 items-center px-1">
        {!settings.nativeMenuBar && !settings.compactMenuBar && (
          <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
        )}

        {/* Menu bar button */}
        {!settings.nativeMenuBar && settings.compactMenuBar && (
          <div className="relative mr-2">
            <Tooltip content="Menu" side="bottom">
              <Button
                onClick={() => {
                  setMenuBarActiveMenu("File");
                }}
                variant="secondary"
                size="icon-sm"
                className="pointer-events-auto"
              >
                <MenuIcon />
              </Button>
            </Tooltip>
            <CustomMenuBar
              activeMenu={menuBarActiveMenu}
              setActiveMenu={setMenuBarActiveMenu}
              compactFloating
            />
          </div>
        )}

        <div className="pointer-events-auto mr-2">
          <SidebarPaneSelector
            isGitViewActive={isGitViewActive}
            isGitHubPRsViewActive={isGitHubPRsViewActive}
            coreFeatures={settings.coreFeatures}
            onViewChange={handleSidebarViewChange}
            onSearchClick={() => setIsGlobalSearchVisible(!isGlobalSearchVisible)}
            compact
          />
        </div>

        {/* Project tabs */}
        <div
          data-title-bar-project-tabs="true"
          className={cn(
            !settings.nativeMenuBar &&
              !settings.compactMenuBar &&
              "-translate-x-1/2 absolute left-1/2",
          )}
        >
          {titleBarProjectMode === "window" ? <WindowTitleDisplay /> : <ProjectTabs />}
        </div>
      </div>

      {/* Right side */}
      <div className="z-20 flex items-center gap-1">
        <RunActionsButton />
        {/* Account menu */}
        <AccountMenu iconSize={12} className="mr-1" />

        {/* Window controls - only show on Linux */}
        {isLinux && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="Minimize" side="bottom">
              <Button
                onClick={handleMinimize}
                variant="secondary"
                size="icon-sm"
                className="pointer-events-auto"
              >
                <Minus className="size-3.5 text-text-lighter" />
              </Button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <Button
                onClick={handleToggleMaximize}
                variant="secondary"
                size="icon-sm"
                className="pointer-events-auto"
              >
                {isMaximized ? (
                  <Minimize2 className="size-3.5 text-text-lighter" />
                ) : (
                  <Maximize2 className="size-3.5 text-text-lighter" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <Button
                onClick={handleClose}
                variant="danger"
                size="icon-sm"
                className="pointer-events-auto group"
              >
                <X className="size-3.5 text-text-lighter group-hover:text-white" />
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

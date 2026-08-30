import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git.store";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { ProjectSwitcher } from "@/features/layout/components/project-switcher";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { AccountMenu } from "@/features/window/components/account-menu";
import { useNativeWindowChrome } from "@/features/window/hooks/use-native-window-chrome";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
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
  FilesIcon,
  FolderOpenIcon,
  ListIcon,
  SidebarSimpleIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { Toggle } from "@/ui/toggle";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import ProjectPicker from "../project-picker";
import WindowMenuBar from "../window-menu-bar";
import { WindowControls } from "./window-controls";

interface TitleBarProps {
  showMinimal?: boolean;
  activityBarExpanded?: boolean;
  onActivityBarExpandedChange?: (expanded: boolean) => void;
}

const TitleBar = ({
  showMinimal = false,
  activityBarExpanded: controlledActivityBarExpanded,
  onActivityBarExpandedChange,
}: TitleBarProps) => {
  const nativeMenuBar = useSettingsStore((state) => state.settings.nativeMenuBar);
  const compactMenuBar = useSettingsStore((state) => state.settings.compactMenuBar);
  const activityRailExpanded = useSettingsStore((state) => state.settings.activityRailExpanded);
  const effectiveActivityBarExpanded = controlledActivityBarExpanded ?? activityRailExpanded;
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const currentBranch = useGitStore((state) => state.workspaceGitStatus?.branch);
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
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

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      void switchToProject(projectId);
    },
    [switchToProject],
  );

  const handleBranchChange = useCallback(() => {
    if (rootFolderPath) void refreshWorkspaceGitStatus(rootFolderPath);
  }, [refreshWorkspaceGitStatus, rootFolderPath]);

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
          <Tooltip content="Menu">
            <Button
              onClick={handleCompactMenuToggle}
              variant="ghost"
              iconOnly
              size="chrome"
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
      size="chrome"
      onPressedChange={(pressed) => {
        if (onActivityBarExpandedChange) onActivityBarExpandedChange(pressed);
        else void updateSetting("activityRailExpanded", pressed);
      }}
      aria-label={effectiveActivityBarExpanded ? "Collapse activity bar" : "Expand activity bar"}
    >
      <SidebarSimpleIcon />
    </Toggle>
  );

  const workspaceSelectors = (
    <ChromeGroup gap="tight" className="min-w-0 shrink overflow-hidden">
      <ProjectSwitcher
        project={activeProject}
        projects={projectTabs}
        isSwitchingProject={isSwitchingProject}
        onSelectProject={handleProjectSelect}
        onAddRemote={() => openProjectPicker("addRemote")}
      />
      {currentBranch && rootFolderPath ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-subtle-foreground/60">
            /
          </span>
          <GitBranchManager
            currentBranch={currentBranch}
            repoPath={rootFolderPath}
            triggerMode="branch"
            onBranchChange={handleBranchChange}
          />
        </>
      ) : null}
    </ChromeGroup>
  );

  const trailingControls = (
    <ChromeGroup gap="tight" className="pointer-events-auto h-full">
      <AppUpdateControl />
      <RunActionsButton />
      <NotificationsTrigger />
      <AccountMenu />
    </ChromeGroup>
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
            {workspaceSelectors}
          </ChromeGroup>

          <div className="h-full">{trailingControls}</div>
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
            {workspaceSelectors}
          </ChromeGroup>
        </ChromeGroup>
        <ChromeGroup className="z-20">
          {trailingControls}
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

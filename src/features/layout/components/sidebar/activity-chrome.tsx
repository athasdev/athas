import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git.store";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { ProjectSwitcher } from "@/features/layout/components/project-switcher";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { AccountMenu } from "@/features/window/components/account-menu";
import ProjectPicker from "@/features/window/components/project-picker";
import WindowMenuBar from "@/features/window/components/window-menu-bar";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { FilesIcon, FolderOpenIcon, ListIcon, TrashIcon, WindowExpandIcon } from "@/ui/icons";
import Tooltip from "@/ui/tooltip";
import { IS_MAC } from "@/utils/platform";

export function ActivityChrome({ expanded }: { expanded: boolean }) {
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
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const projectPickerInitialStep = useUIState((state) => state.projectPickerInitialStep);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isCompactMenuVisible, setIsCompactMenuVisible] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  const handleCloseAllProjects = useCallback(async () => {
    for (const tab of useWorkspaceTabsStore.getState().projectTabs) {
      await closeProject(tab.id);
    }
  }, [closeProject]);

  const menuItem = !IS_MAC ? (
    <div ref={menuAnchorRef}>
      <Tooltip content="Menu">
        <Button
          onClick={() => {
            setMenuBarActiveMenu(null);
            setIsCompactMenuVisible((visible) => !visible);
          }}
          variant="ghost"
          iconOnly
          size="sm"
          active={isCompactMenuVisible}
          aria-label="Menu"
          aria-expanded={isCompactMenuVisible}
        >
          <ListIcon />
        </Button>
      </Tooltip>
    </div>
  ) : null;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          className="flex w-full shrink-0 flex-col gap-chrome-tight px-chrome-inline pb-1"
          onContextMenu={(event) => event.stopPropagation()}
        >
          {menuItem}
          <div className="min-w-0 overflow-hidden">
            <ProjectSwitcher
              project={activeProject}
              projects={projectTabs}
              isSwitchingProject={isSwitchingProject}
              onSelectProject={(projectId) => void switchToProject(projectId)}
              onAddRemote={() => openProjectPicker("addRemote")}
              compact={!expanded}
            />
          </div>
          {expanded && currentBranch && rootFolderPath ? (
            <div className="min-w-0 overflow-hidden">
              <GitBranchManager
                currentBranch={currentBranch}
                repoPath={rootFolderPath}
                triggerMode="branch"
                onBranchChange={() => void refreshWorkspaceGitStatus(rootFolderPath)}
              />
            </div>
          ) : null}
        </ContextMenuTrigger>
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
          <ContextMenuItem
            onClick={() =>
              void openFolder().then((path) => path && createAppWindow({ path, isDirectory: true }))
            }
          >
            <WindowExpandIcon />
            Open Folder in New Window
          </ContextMenuItem>
          {projectTabs.length > 0 ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void handleCloseAllProjects()}>
                <TrashIcon />
                Close All Projects
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      {isCompactMenuVisible &&
        menuAnchorRef.current &&
        createPortal(
          <div
            className="fixed z-100000"
            style={{
              top: menuAnchorRef.current.getBoundingClientRect().bottom,
              left: menuAnchorRef.current.getBoundingClientRect().left,
            }}
          >
            <WindowMenuBar
              activeMenu={menuBarActiveMenu}
              setActiveMenu={setMenuBarActiveMenu}
              compactFloating
              onCompactClose={() => {
                setMenuBarActiveMenu(null);
                setIsCompactMenuVisible(false);
              }}
            />
          </div>,
          document.body,
        )}
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
}

export function ActivityChromeFooter({ expanded }: { expanded: boolean }) {
  return (
    <div className="flex w-full flex-col gap-chrome-tight">
      <div
        className={
          expanded
            ? "flex flex-wrap items-center justify-center gap-chrome-tight"
            : "flex flex-col items-center gap-chrome-tight"
        }
      >
        <AppUpdateControl compact />
        <RunActionsButton />
        <NotificationsTrigger />
      </div>
      <AccountMenu expanded={expanded} />
    </div>
  );
}

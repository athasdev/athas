import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git.store";
import { ProjectSwitcher } from "@/features/layout/components/project-switcher";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { WindowMenuDropdown } from "@/features/window/components/window-menu-bar";
import { AthasMark } from "@/ui/brand-marks";
import { Button } from "@/ui/button";
import { ControlSizeProvider } from "@/ui/control-size";
import { SidebarIcon } from "@/ui/icons";
import { Toggle } from "@/ui/toggle";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { cn } from "@/utils/cn";
import { IS_MAC } from "@/utils/platform";

/**
 * The leading end of the title bar, next to the window controls: the app menu (Windows and Linux,
 * where there is no native menu bar), the sidebar toggle, then the project and branch the
 * workbench is on.
 */
export function TitleLeading() {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const toggleSidebarShortcut = useCommandShortcut("workbench.toggleSidebar");
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const currentBranch = useGitStore((state) => state.workspaceGitStatus?.branch);
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);

  return (
    <ControlSizeProvider size={IS_MAC ? "sm" : "lg"}>
      <div
        data-slot="title-leading"
        className={cn(
          "absolute inset-y-0 left-0 z-10 flex max-w-[50%] min-w-0 items-center pl-title-bar-leading",
          IS_MAC ? "gap-0.5" : "gap-1",
        )}
      >
        {IS_MAC ? null : (
          <div className="-ml-0.5 flex shrink-0">
            <WindowMenuDropdown
              trigger={<Button variant="ghost" iconOnly tooltip="Menu" aria-label="Menu" />}
            >
              <AthasMark size="1rem" />
            </WindowMenuDropdown>
          </div>
        )}
        <div className="flex shrink-0">
          <Toggle
            type="button"
            pressed={isSidebarVisible}
            onPressedChange={setIsSidebarVisible}
            tooltip={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
            shortcut={toggleSidebarShortcut}
            aria-label={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
          >
            <SidebarIcon />
          </Toggle>
        </div>
        <ProjectSwitcher
          project={activeProject}
          projects={projectTabs}
          isSwitchingProject={isSwitchingProject}
          onSelectProject={(projectId) => void switchToProject(projectId)}
          onAddRemote={() => openProjectPicker("addRemote")}
        />
        {currentBranch && rootFolderPath ? (
          <GitBranchManager
            currentBranch={currentBranch}
            repoPath={rootFolderPath}
            triggerMode="branch"
            onBranchChange={() => void refreshWorkspaceGitStatus(rootFolderPath)}
          />
        ) : null}
      </div>
    </ControlSizeProvider>
  );
}

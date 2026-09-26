import { forwardRef } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git.store";
import { ProjectSwitcher } from "@/features/layout/components/project-switcher";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { SidebarIcon } from "@/ui/icons";
import { Toggle } from "@/ui/toggle";

/**
 * The leading end of the title bar, next to the window controls: the sidebar toggle, then the
 * project and branch the workbench is on.
 */
export const TitleLeading = forwardRef<HTMLDivElement>(function TitleLeading(_props, ref) {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const currentBranch = useGitStore((state) => state.workspaceGitStatus?.branch);
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);

  return (
    <div
      ref={ref}
      data-slot="title-leading"
      className="absolute inset-y-0 left-0 z-10 flex max-w-[50%] min-w-0 items-center gap-1 pl-title-bar-leading"
    >
      <Toggle
        type="button"
        size="md"
        pressed={isSidebarVisible}
        onPressedChange={setIsSidebarVisible}
        tooltip={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
        commandId="workbench.toggleSidebar"
        aria-label={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
      >
        <SidebarIcon />
      </Toggle>
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
  );
});

import { ActivityProjectSwitcher } from "@/features/layout/components/sidebar/activity-project-switcher";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { MagnifyingGlassIcon } from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

interface ActivityProjectToolbarProps {
  expanded: boolean;
  project?: ProjectTab;
  projects: ProjectTab[];
  isSwitchingProject: boolean;
  showProjectSwitcher: boolean;
  showSearch: boolean;
  onSelectProject: (projectId: string) => void;
  onAddRemote: () => void;
  onSearch: () => void;
}

export function ActivityProjectToolbar({
  expanded,
  project,
  projects,
  isSwitchingProject,
  showProjectSwitcher,
  showSearch,
  onSelectProject,
  onAddRemote,
  onSearch,
}: ActivityProjectToolbarProps) {
  const tooltipSide = expanded ? "bottom" : "right";

  return (
    <div
      data-slot="activity-project-toolbar"
      className={cn(
        "flex w-full shrink-0 gap-chrome-tight px-chrome-inline pt-2",
        expanded ? "items-center" : "flex-col items-center",
      )}
    >
      {showProjectSwitcher ? (
        <div className={cn("min-w-0", expanded && "flex-1")}>
          <ActivityProjectSwitcher
            expanded={expanded}
            project={project}
            projects={projects}
            isSwitchingProject={isSwitchingProject}
            onSelectProject={onSelectProject}
            onAddRemote={onAddRemote}
          />
        </div>
      ) : null}
      <div
        className={cn(
          "flex shrink-0 items-center gap-chrome-tight",
          expanded ? "ml-auto" : "flex-col",
        )}
      >
        {showSearch ? (
          <SidebarIconButton
            onClick={onSearch}
            tooltip="Search"
            tooltipSide={tooltipSide}
            commandId="workbench.showGlobalSearch"
            aria-label="Search"
          >
            <MagnifyingGlassIcon />
          </SidebarIconButton>
        ) : null}
        <NotificationsTrigger tooltipSide={tooltipSide} />
      </div>
    </div>
  );
}

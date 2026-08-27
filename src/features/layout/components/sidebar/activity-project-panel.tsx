import { ActivityAgentHistory } from "@/features/layout/components/sidebar/activity-agent-history";
import {
  ActivityRailNavigation,
  ActivitySidebarNavigation,
} from "@/features/layout/components/sidebar/activity-navigation";
import { ActivityPinnedItems } from "@/features/layout/components/sidebar/activity-pinned-items";
import { ActivityProjectSwitcher } from "@/features/layout/components/sidebar/activity-project-switcher";
import { ActivityTerminalHistory } from "@/features/layout/components/sidebar/activity-terminal-history";
import { ActivityWorktreeHistory } from "@/features/layout/components/sidebar/activity-worktree-history";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ActivityProjectPanelProps {
  expanded: boolean;
  project: ProjectTab;
  projects: ProjectTab[];
  current: boolean;
  loading: boolean;
  switchingProject: boolean;
  reserveProjectDots: boolean;
  navigationItems: ActivityNavigationItem[];
  footerNavigationItems: ActivityNavigationItem[];
  showProjectSwitcher: boolean;
  showAgents: boolean;
  showTerminals: boolean;
  showWorktrees: boolean;
  onSelectProject: (projectId: string) => void;
  onAddRemote: () => void;
  onNewWorktree: () => void;
}

export function ActivityProjectPanel({
  expanded,
  project,
  projects,
  current,
  loading,
  switchingProject,
  reserveProjectDots,
  navigationItems,
  footerNavigationItems,
  showProjectSwitcher,
  showAgents,
  showTerminals,
  showWorktrees,
  onSelectProject,
  onAddRemote,
  onNewWorktree,
}: ActivityProjectPanelProps) {
  return (
    <div
      data-project-carousel-current={current ? "true" : undefined}
      aria-hidden={current ? undefined : true}
      inert={current ? undefined : true}
      className={cn(
        "relative box-border flex h-full w-full shrink-0 snap-start snap-always flex-col items-start gap-2 overflow-hidden pt-2",
        expanded ? "pl-chrome-inline" : "px-chrome-inline",
        expanded && reserveProjectDots ? "pb-7" : "pb-1.5",
        !current && "pointer-events-none",
      )}
    >
      {showProjectSwitcher ? (
        <ActivityProjectSwitcher
          expanded={expanded}
          project={project}
          projects={projects}
          isSwitchingProject={switchingProject}
          onSelectProject={onSelectProject}
          onAddRemote={onAddRemote}
        />
      ) : null}
      {loading ? (
        <div className="flex min-h-0 flex-1 self-stretch items-center justify-center">
          <Spinner label={`Opening ${project.name}`} showLabel={expanded} compact={!expanded} />
        </div>
      ) : (
        <div className="scrollbar-none min-h-0 w-full flex-1 overflow-y-auto">
          {expanded ? (
            <ActivitySidebarNavigation items={navigationItems} />
          ) : (
            <ActivityRailNavigation items={navigationItems} />
          )}
          {expanded ? (
            <>
              <ActivityPinnedItems
                workspacePath={project.path}
                showAgents={showAgents}
                showTerminals={showTerminals}
              />
              {showAgents ? <ActivityAgentHistory workspacePath={project.path} /> : null}
              {showTerminals ? <ActivityTerminalHistory /> : null}
              {showWorktrees ? (
                <ActivityWorktreeHistory repoPath={project.path} onNewWorktree={onNewWorktree} />
              ) : null}
            </>
          ) : null}
        </div>
      )}
      <div className="w-full shrink-0">
        {expanded ? (
          <ActivitySidebarNavigation items={footerNavigationItems} />
        ) : (
          <ActivityRailNavigation items={footerNavigationItems} />
        )}
      </div>
    </div>
  );
}

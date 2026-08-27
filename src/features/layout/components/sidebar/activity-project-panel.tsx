import { ActivityAgentHistory } from "@/features/layout/components/sidebar/activity-agent-history";
import {
  ActivityRailNavigation,
  ActivitySidebarNavigation,
} from "@/features/layout/components/sidebar/activity-navigation";
import { ActivityPinnedItems } from "@/features/layout/components/sidebar/activity-pinned-items";
import { ActivityTerminalHistory } from "@/features/layout/components/sidebar/activity-terminal-history";
import { ActivityWorktreeHistory } from "@/features/layout/components/sidebar/activity-worktree-history";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ActivityProjectPanelProps {
  expanded: boolean;
  project: ProjectTab;
  current: boolean;
  loading: boolean;
  navigationItems: ActivityNavigationItem[];
  showAgents: boolean;
  showTerminals: boolean;
  showWorktrees: boolean;
  onNewWorktree: () => void;
}

export function ActivityProjectPanel({
  expanded,
  project,
  current,
  loading,
  navigationItems,
  showAgents,
  showTerminals,
  showWorktrees,
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
        "pb-1.5",
        !current && "pointer-events-none",
      )}
    >
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
    </div>
  );
}

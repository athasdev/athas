import { ActivityRailNavigation } from "@/features/layout/components/sidebar/activity-navigation";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ActivityProjectPanelProps {
  project: ProjectTab;
  current: boolean;
  loading: boolean;
  navigationItems: ActivityNavigationItem[];
}

export function ActivityProjectPanel({
  project,
  current,
  loading,
  navigationItems,
}: ActivityProjectPanelProps) {
  return (
    <div
      data-project-carousel-current={current ? "true" : undefined}
      aria-hidden={current ? undefined : true}
      inert={current ? undefined : true}
      className={cn(
        "relative box-border flex h-full w-full shrink-0 snap-start snap-always flex-col items-start gap-2 overflow-hidden px-chrome-inline pb-1.5",
        !current && "pointer-events-none",
      )}
    >
      {loading ? (
        <div className="flex min-h-0 flex-1 self-stretch items-center justify-center">
          <Spinner label={`Opening ${project.name}`} compact />
        </div>
      ) : (
        <div className="scrollbar-none min-h-0 w-full flex-1 overflow-y-auto">
          <ActivityRailNavigation items={navigationItems} />
        </div>
      )}
    </div>
  );
}

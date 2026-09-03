import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

function ActivityNavigationList({
  items,
  collapsed,
}: {
  items: ActivityNavigationItem[];
  collapsed: boolean;
}) {
  return (
    <nav
      data-slot={collapsed ? "activity-rail-navigation" : "activity-sidebar-navigation"}
      aria-label="Activity views"
      className="flex w-full flex-col gap-chrome-tight"
    >
      {items.map((item) => {
        if (collapsed) {
          return (
            <Tooltip key={item.id} content={item.label} shortcut={item.shortcut}>
              <SidebarIconButton
                active={item.active}
                onClick={item.onClick}
                aria-label={item.ariaLabel}
                aria-current={item.active ? "page" : undefined}
              >
                {item.icon}
              </SidebarIconButton>
            </Tooltip>
          );
        }

        return (
          <SidebarListItem
            key={item.id}
            active={item.active}
            leading={item.icon}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            aria-current={item.active ? "page" : undefined}
          >
            {item.label}
          </SidebarListItem>
        );
      })}
    </nav>
  );
}

export function ActivityRailNavigation({ items }: { items: ActivityNavigationItem[] }) {
  return <ActivityNavigationList items={items} collapsed />;
}

export function ActivitySidebarNavigation({ items }: { items: ActivityNavigationItem[] }) {
  return <ActivityNavigationList items={items} collapsed={false} />;
}

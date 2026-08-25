import { Fragment } from "react";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/dropdown";
import { SidebarListItem, SidebarListMenuItem } from "@/ui/sidebar";
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
        const control = item.submenuItems?.length ? (
          <SidebarListMenuItem
            active={item.active}
            appearance="activity"
            leading={item.icon}
            iconOnly={collapsed}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            aria-current={item.active ? "page" : undefined}
            menuLabel={`Choose ${item.label} view`}
            menu={item.submenuItems.map((submenuItem) => (
              <Fragment key={submenuItem.id}>
                {submenuItem.separatorBefore ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={submenuItem.onClick}>
                  {submenuItem.icon}
                  {submenuItem.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
          >
            {item.label}
          </SidebarListMenuItem>
        ) : (
          <SidebarListItem
            active={item.active}
            appearance="activity"
            leading={item.icon}
            iconOnly={collapsed}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            aria-current={item.active ? "page" : undefined}
          >
            {item.label}
          </SidebarListItem>
        );

        return collapsed ? (
          <Tooltip key={item.id} content={item.label} shortcut={item.shortcut} side="right">
            {control}
          </Tooltip>
        ) : (
          <Fragment key={item.id}>{control}</Fragment>
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

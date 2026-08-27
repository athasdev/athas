import { Fragment } from "react";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarListMenuItem,
  SidebarMenuContent,
} from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

function ActivityNavigationMenu({ item }: { item: ActivityNavigationItem }) {
  return item.submenuItems?.map((submenuItem) => (
    <Fragment key={submenuItem.id}>
      {submenuItem.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onClick={submenuItem.onClick}>
        {submenuItem.icon}
        {submenuItem.label}
      </DropdownMenuItem>
    </Fragment>
  ));
}

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
          const iconButton = (
            <SidebarIconButton
              active={item.active}
              onClick={item.submenuItems?.length ? undefined : item.onClick}
              aria-label={item.ariaLabel}
              aria-current={item.active ? "page" : undefined}
            >
              {item.icon}
            </SidebarIconButton>
          );

          const control = item.submenuItems?.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={iconButton} />
              <SidebarMenuContent>
                <ActivityNavigationMenu item={item} />
              </SidebarMenuContent>
            </DropdownMenu>
          ) : (
            iconButton
          );

          return (
            <Tooltip key={item.id} content={item.label} shortcut={item.shortcut} side="right">
              {control}
            </Tooltip>
          );
        }

        return item.submenuItems?.length ? (
          <SidebarListMenuItem
            key={item.id}
            active={item.active}
            leading={item.icon}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            aria-current={item.active ? "page" : undefined}
            menuLabel={`Choose ${item.label} view`}
            menu={<ActivityNavigationMenu item={item} />}
          >
            {item.label}
          </SidebarListMenuItem>
        ) : (
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

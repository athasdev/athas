import { Fragment } from "react";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { SidebarIconButton, SidebarListItem, SidebarMenuContent } from "@/ui/sidebar";
import { Separator } from "@/ui/separator";
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

        return (
          <div key={item.id} className="flex w-full min-w-0 flex-col gap-chrome-tight">
            <SidebarListItem
              active={item.active}
              leading={item.icon}
              onClick={item.onClick}
              aria-label={item.ariaLabel}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
            </SidebarListItem>
            {item.active && item.submenuItems?.length ? (
              <div
                data-slot="activity-sidebar-subnavigation"
                role="group"
                aria-label={`${item.label} sections`}
                className="flex w-full min-w-0 flex-col gap-chrome-tight pl-4"
              >
                {item.submenuItems.map((submenuItem) => (
                  <Fragment key={submenuItem.id}>
                    {submenuItem.separatorBefore ? (
                      <Separator className="my-chrome-tight opacity-60" />
                    ) : null}
                    <SidebarListItem
                      active={submenuItem.active}
                      leading={submenuItem.icon}
                      onClick={submenuItem.onClick}
                      aria-label={`${item.label}: ${submenuItem.label}`}
                      aria-current={submenuItem.active ? "page" : undefined}
                    >
                      {submenuItem.label}
                    </SidebarListItem>
                  </Fragment>
                ))}
              </div>
            ) : null}
          </div>
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

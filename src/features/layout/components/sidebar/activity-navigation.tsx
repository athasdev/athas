import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/ui/dropdown";
import { DotsIcon, ChevronDownIcon } from "@/ui/icons";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

const moreViewIds = new Set(["views", "debugger", "databases", "workspaces", "docker"]);

function NavigationItem({ item, collapsed }: { item: ActivityNavigationItem; collapsed: boolean }) {
  return collapsed ? (
    <Tooltip content={item.label} shortcut={item.shortcut}>
      <SidebarIconButton
        active={item.active}
        onClick={item.onClick}
        aria-label={item.ariaLabel}
        aria-current={item.active ? "page" : undefined}
      >
        {item.icon}
      </SidebarIconButton>
    </Tooltip>
  ) : (
    <SidebarListItem
      active={item.active}
      leading={item.icon}
      onClick={item.onClick}
      aria-label={item.ariaLabel}
      aria-current={item.active ? "page" : undefined}
    >
      {item.label}
    </SidebarListItem>
  );
}

function MoreViews({ items, collapsed }: { items: ActivityNavigationItem[]; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const activeItem = items.find((item) => item.active);
  const groups = [
    items.filter((item) => item.id === "views" || item.id === "workspaces"),
    items.filter((item) => item.id !== "views" && item.id !== "workspaces"),
  ].filter((group) => group.length > 0);
  const label = activeItem ? `More views: ${activeItem.label}` : "More views";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {collapsed ? (
        <Tooltip content={label}>
          <DropdownMenuTrigger
            render={<SidebarIconButton active={Boolean(activeItem) || open} aria-label={label} />}
          >
            <DotsIcon />
          </DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <SidebarListItem
          render={<DropdownMenuTrigger />}
          active={Boolean(activeItem) || open}
          leading={<DotsIcon />}
          trailing={<ChevronDownIcon />}
          aria-label={label}
        >
          More
        </SidebarListItem>
      )}
      <DropdownMenuContent side={collapsed ? "right" : "bottom"} align="start" size="default">
        <DropdownMenuRadioGroup value={activeItem?.id ?? ""}>
          {groups.map((group, index) => (
            <div key={group[0].id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {group.map((item) => (
                <DropdownMenuRadioItem
                  key={item.id}
                  value={item.id}
                  onClick={item.onClick}
                  aria-label={item.ariaLabel}
                >
                  {item.icon}
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActivityNavigationList({
  items,
  collapsed,
}: {
  items: ActivityNavigationItem[];
  collapsed: boolean;
}) {
  const moreItems = items.filter((item) => moreViewIds.has(item.id));
  const primaryItems = items.filter((item) => !moreViewIds.has(item.id));
  const groups = [
    {
      label: "Project navigation",
      items: primaryItems.filter((item) => item.id === "files" || item.id === "search"),
    },
    {
      label: "Version control",
      items: primaryItems.filter((item) => item.id === "git" || item.id === "github-prs"),
    },
    {
      label: "Tools",
      items: primaryItems.filter(
        (item) => !["files", "search", "git", "github-prs"].includes(item.id),
      ),
      more: true,
    },
  ];
  return (
    <nav
      data-slot={collapsed ? "activity-rail-navigation" : "activity-sidebar-navigation"}
      aria-label="Activity views"
      className="flex w-full flex-col gap-2"
    >
      {groups
        .filter((group) => group.items.length > 0 || (group.more && moreItems.length > 0))
        .map((group) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            className="flex flex-col gap-chrome-tight"
          >
            {group.items.map((item) => (
              <NavigationItem key={item.id} item={item} collapsed={collapsed} />
            ))}
            {group.more && moreItems.length > 0 ? (
              <MoreViews items={moreItems} collapsed={collapsed} />
            ) : null}
          </div>
        ))}
    </nav>
  );
}

export function ActivityRailNavigation({ items }: { items: ActivityNavigationItem[] }) {
  return <ActivityNavigationList items={items} collapsed />;
}

export function ActivitySidebarNavigation({ items }: { items: ActivityNavigationItem[] }) {
  return <ActivityNavigationList items={items} collapsed={false} />;
}

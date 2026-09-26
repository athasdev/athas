import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/ui/dropdown";
import { DotsIcon } from "@/ui/icons";
import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import { SidebarIconButton } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

const moreViewIds = new Set(["views", "debugger", "databases", "workspaces", "docker"]);

function NavigationItem({ item }: { item: ActivityNavigationItem }) {
  return (
    <Tooltip content={item.label} shortcut={item.shortcut}>
      <SidebarIconButton
        size="lg"
        solidWhenActive
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

function MoreViews({ items }: { items: ActivityNavigationItem[] }) {
  const activeItem = items.find((item) => item.active);
  const groups = [
    items.filter((item) => item.id === "views" || item.id === "workspaces"),
    items.filter((item) => item.id !== "views" && item.id !== "workspaces"),
  ].filter((group) => group.length > 0);
  const label = activeItem ? `More views: ${activeItem.label}` : "More views";
  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger
          render={
            <SidebarIconButton
              size="lg"
              solidWhenActive
              active={Boolean(activeItem)}
              aria-label={label}
            />
          }
        >
          <DotsIcon />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" size="default">
        <DropdownMenuRadioGroup value={activeItem?.id ?? ""}>
          {groups.map((group, index) => (
            <div key={group[0].id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {group.map((item) => (
                <DropdownMenuRadioItem
                  key={item.id}
                  value={item.id}
                  closeOnClick
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

export function ActivityRailNavigation({ items }: { items: ActivityNavigationItem[] }) {
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
      label: "Agents",
      items: primaryItems.filter((item) => item.id === "agents"),
    },
    {
      label: "Tools",
      items: primaryItems.filter(
        (item) => !["agents", "files", "search", "git", "github-prs"].includes(item.id),
      ),
      more: true,
    },
  ];
  return (
    <nav
      data-slot="activity-rail-navigation"
      aria-label="Activity views"
      className="flex w-full flex-col gap-1"
    >
      {groups
        .filter((group) => group.items.length > 0 || (group.more && moreItems.length > 0))
        .map((group) => (
          <div
            key={group.label}
            role="group"
            aria-label={group.label}
            className="flex flex-col gap-1"
          >
            {group.items.map((item) => (
              <NavigationItem key={item.id} item={item} />
            ))}
            {group.more && moreItems.length > 0 ? <MoreViews items={moreItems} /> : null}
          </div>
        ))}
    </nav>
  );
}

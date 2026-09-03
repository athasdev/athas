import type { ReactNode } from "react";
import {
  GIT_SIDEBAR_ITEM_IDS,
  GIT_SIDEBAR_TAB_IDS,
  type GitSidebarItemId,
  type GitSidebarTabId,
  normalizeItemOrder,
} from "@/features/layout/config/item-order";
import type { GitActivitySection } from "@/features/layout/stores/sidebar.store";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  ArchiveIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  GitDiffIcon,
  ListChecksIcon,
  NetworkIcon,
  TagIcon,
} from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarMenuContent,
  SidebarNavigation,
  type SidebarNavigationItem,
} from "@/ui/sidebar";

interface SourceControlNavigationProps {
  activeSection: GitActivitySection;
  sectionOrder: GitSidebarTabId[];
  hiddenItemIds: GitSidebarItemId[];
  changeCount: number;
  commitCount: number;
  activeRepositoryItem?: Extract<GitSidebarItemId, "remotes" | "tags" | "stashes">;
  onSectionChange: (section: GitActivitySection) => void;
  onOpenRemotes: () => void;
  onOpenTags: () => void;
  onOpenStashes: () => void;
  onItemVisibleChange: (itemId: GitSidebarItemId, visible: boolean) => void;
}

const labels: Record<GitSidebarItemId, string> = {
  changes: "Changes",
  history: "History",
  review: "Review",
  remotes: "Remotes",
  tags: "Tags",
  stashes: "Stashes",
};

const icons: Record<GitSidebarItemId, ReactNode> = {
  changes: <GitDiffIcon />,
  history: <ClockCounterClockwiseIcon />,
  review: <ListChecksIcon />,
  remotes: <NetworkIcon />,
  tags: <TagIcon />,
  stashes: <ArchiveIcon />,
};

function SourceControlNavigationVisibilityMenu({
  hiddenItemIds,
  onItemVisibleChange,
}: Pick<SourceControlNavigationProps, "hiddenItemIds" | "onItemVisibleChange">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarIconButton
            tooltip="Choose visible Source Control items"
            aria-label="Choose visible Source Control items"
          />
        }
      >
        <DotsThreeIcon />
      </DropdownMenuTrigger>
      <SidebarMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          {GIT_SIDEBAR_TAB_IDS.map((itemId) => (
            <DropdownMenuCheckboxItem
              key={itemId}
              checked={!hiddenItemIds.includes(itemId)}
              closeOnClick={false}
              onCheckedChange={(checked) => onItemVisibleChange(itemId, checked)}
            >
              {icons[itemId]}
              {labels[itemId]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Repository</DropdownMenuLabel>
          {GIT_SIDEBAR_ITEM_IDS.filter(
            (itemId): itemId is Extract<GitSidebarItemId, "remotes" | "tags" | "stashes"> =>
              !GIT_SIDEBAR_TAB_IDS.includes(itemId as GitSidebarTabId),
          ).map((itemId) => (
            <DropdownMenuCheckboxItem
              key={itemId}
              checked={!hiddenItemIds.includes(itemId)}
              closeOnClick={false}
              onCheckedChange={(checked) => onItemVisibleChange(itemId, checked)}
            >
              {icons[itemId]}
              {labels[itemId]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </SidebarMenuContent>
    </DropdownMenu>
  );
}

export function SourceControlNavigation({
  activeSection,
  sectionOrder,
  hiddenItemIds,
  changeCount,
  commitCount,
  activeRepositoryItem,
  onSectionChange,
  onOpenRemotes,
  onOpenTags,
  onOpenStashes,
  onItemVisibleChange,
}: SourceControlNavigationProps) {
  const viewItems: SidebarNavigationItem[] = normalizeItemOrder(sectionOrder, GIT_SIDEBAR_TAB_IDS)
    .filter((itemId) => !hiddenItemIds.includes(itemId))
    .map((itemId) => ({
      id: itemId,
      label: labels[itemId],
      leading: icons[itemId],
      trailing:
        itemId === "changes"
          ? changeCount || undefined
          : itemId === "history"
            ? commitCount || undefined
            : undefined,
      active: activeSection === itemId,
      onClick: () => onSectionChange(itemId),
      ariaLabel: `Source Control: ${labels[itemId]}`,
    }));
  const repositoryActions = {
    remotes: onOpenRemotes,
    tags: onOpenTags,
    stashes: onOpenStashes,
  };
  const repositoryItems: SidebarNavigationItem[] = (["remotes", "tags", "stashes"] as const)
    .filter((itemId) => !hiddenItemIds.includes(itemId))
    .map((itemId) => ({
      id: itemId,
      label: labels[itemId],
      leading: icons[itemId],
      active: activeRepositoryItem === itemId,
      onClick: repositoryActions[itemId],
      ariaLabel: `Source Control: ${labels[itemId]}`,
    }));

  return (
    <SidebarNavigation
      label="Source Control sections"
      groups={[
        {
          id: "views",
          title: "Views",
          items: viewItems,
          action: (
            <SourceControlNavigationVisibilityMenu
              hiddenItemIds={hiddenItemIds}
              onItemVisibleChange={onItemVisibleChange}
            />
          ),
        },
        ...(repositoryItems.length > 0
          ? [{ id: "repository", title: "Repository", items: repositoryItems }]
          : []),
      ]}
    />
  );
}

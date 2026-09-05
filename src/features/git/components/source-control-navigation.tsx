import {
  GIT_SIDEBAR_TAB_IDS,
  type GitSidebarItemId,
  type GitSidebarTabId,
  normalizeItemOrder,
} from "@/features/layout/config/item-order";
import type { GitActivitySection } from "@/features/layout/stores/sidebar.store";
import { SidebarTabBar } from "@/ui/sidebar";
import { SOURCE_CONTROL_ITEM_ICONS, SOURCE_CONTROL_ITEM_LABELS } from "./source-control-items";

interface SourceControlNavigationProps {
  activeSection: GitActivitySection;
  sectionOrder: GitSidebarTabId[];
  hiddenItemIds: GitSidebarItemId[];
  changeCount: number;
  commitCount: number;
  onSectionChange: (section: GitActivitySection) => void;
}

export function SourceControlNavigation({
  activeSection,
  sectionOrder,
  hiddenItemIds,
  changeCount,
  commitCount,
  onSectionChange,
}: SourceControlNavigationProps) {
  const viewItems = normalizeItemOrder(sectionOrder, GIT_SIDEBAR_TAB_IDS)
    .filter((itemId) => !hiddenItemIds.includes(itemId))
    .map((itemId) => ({
      id: itemId,
      label: SOURCE_CONTROL_ITEM_LABELS[itemId],
      icon: SOURCE_CONTROL_ITEM_ICONS[itemId],
      badge:
        itemId === "changes"
          ? changeCount || undefined
          : itemId === "history"
            ? commitCount || undefined
            : undefined,
      ariaLabel: `Source Control: ${SOURCE_CONTROL_ITEM_LABELS[itemId]}`,
    }));
  const repositoryItems = (["remotes", "tags", "stashes"] as const)
    .filter((itemId) => !hiddenItemIds.includes(itemId))
    .map((itemId) => ({
      id: itemId,
      label: SOURCE_CONTROL_ITEM_LABELS[itemId],
      icon: SOURCE_CONTROL_ITEM_ICONS[itemId],
      ariaLabel: `Source Control: ${SOURCE_CONTROL_ITEM_LABELS[itemId]}`,
      badge: undefined,
    }));

  return (
    <SidebarTabBar
      label="Source Control sections"
      items={[...viewItems, ...repositoryItems]}
      value={activeSection}
      onChange={onSectionChange}
    />
  );
}

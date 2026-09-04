import {
  SIDEBAR_ACTIVITY_ITEM_IDS,
  type SidebarActivityItemId,
} from "@/features/layout/config/item-order";

export function isCoreActivityNavigationItem(itemId: string): itemId is SidebarActivityItemId {
  return SIDEBAR_ACTIVITY_ITEM_IDS.includes(itemId as SidebarActivityItemId);
}

export function isActivityNavigationItemVisible(
  itemId: string,
  hiddenCoreItemIds: string[],
  pinnedExtensionItemIds: string[],
) {
  return isCoreActivityNavigationItem(itemId)
    ? !hiddenCoreItemIds.includes(itemId)
    : pinnedExtensionItemIds.includes(itemId);
}

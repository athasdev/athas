import { useCallback, useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  isActivityNavigationItemVisible,
  isCoreActivityNavigationItem,
} from "@/features/layout/utils/activity-navigation-visibility";

export function useActivityBarVisibility() {
  const storedHiddenNavigationItemIds = useSettingsStore(
    (state) => state.settings.hiddenSidebarActivityItems,
  );
  const hiddenNavigationItemIds = useMemo(
    () => storedHiddenNavigationItemIds.filter((itemId) => itemId !== "search"),
    [storedHiddenNavigationItemIds],
  );
  const pinnedExtensionItemIds = useSettingsStore(
    (state) => state.settings.pinnedSidebarExtensionItems,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  const setNavigationItemVisible = useCallback(
    (itemId: string, visible: boolean) => {
      if (!isCoreActivityNavigationItem(itemId)) {
        const currentPinnedItems = useSettingsStore.getState().settings.pinnedSidebarExtensionItems;
        const nextPinnedItems = visible
          ? Array.from(new Set([...currentPinnedItems, itemId]))
          : currentPinnedItems.filter((pinnedItemId) => pinnedItemId !== itemId);
        void updateSetting("pinnedSidebarExtensionItems", nextPinnedItems);
        return;
      }

      const currentHiddenItems = useSettingsStore.getState().settings.hiddenSidebarActivityItems;
      const nextHiddenItems = visible
        ? currentHiddenItems.filter((hiddenItemId) => hiddenItemId !== itemId)
        : Array.from(new Set([...currentHiddenItems, itemId]));

      void updateSetting("hiddenSidebarActivityItems", nextHiddenItems);
    },
    [updateSetting],
  );

  const isNavigationItemVisible = useCallback(
    (itemId: string) =>
      isActivityNavigationItemVisible(itemId, hiddenNavigationItemIds, pinnedExtensionItemIds),
    [hiddenNavigationItemIds, pinnedExtensionItemIds],
  );

  const showAll = useCallback(
    (navigationItemIds: string[]) => {
      void updateSetting("hiddenSidebarActivityItems", []);
      void updateSetting(
        "pinnedSidebarExtensionItems",
        navigationItemIds.filter((itemId) => !isCoreActivityNavigationItem(itemId)),
      );
    },
    [updateSetting],
  );

  return {
    isNavigationItemVisible,
    setNavigationItemVisible,
    showAll,
  };
}

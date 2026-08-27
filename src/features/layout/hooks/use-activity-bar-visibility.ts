import { useCallback } from "react";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

const VISIBILITY_SETTING_BY_ITEM = {
  projectSwitcher: "showActivityRailProjectSwitcher",
  agentHistory: "showActivityRailAgentHistory",
  terminals: "showActivityRailTerminals",
  worktrees: "showActivityRailWorktrees",
  projectDots: "showActivityRailProjectIcons",
} as const;

export type ActivityBarVisibilityItem = keyof typeof VISIBILITY_SETTING_BY_ITEM;

export function useActivityBarVisibility(coreFeatures: CoreFeaturesState) {
  const hiddenNavigationItemIds = useSettingsStore(
    (state) => state.settings.hiddenSidebarActivityItems,
  );
  const projectSwitcher = useSettingsStore(
    (state) => state.settings.showActivityRailProjectSwitcher,
  );
  const agentHistory = useSettingsStore((state) => state.settings.showActivityRailAgentHistory);
  const terminals = useSettingsStore((state) => state.settings.showActivityRailTerminals);
  const worktrees = useSettingsStore((state) => state.settings.showActivityRailWorktrees);
  const projectDots = useSettingsStore((state) => state.settings.showActivityRailProjectIcons);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  const setNavigationItemVisible = useCallback(
    (itemId: string, visible: boolean) => {
      const currentHiddenItems = useSettingsStore.getState().settings.hiddenSidebarActivityItems;
      const nextHiddenItems = visible
        ? currentHiddenItems.filter((hiddenItemId) => hiddenItemId !== itemId)
        : Array.from(new Set([...currentHiddenItems, itemId]));

      void updateSetting("hiddenSidebarActivityItems", nextHiddenItems);
    },
    [updateSetting],
  );

  const setItemVisible = useCallback(
    (item: ActivityBarVisibilityItem, visible: boolean) => {
      void updateSetting(VISIBILITY_SETTING_BY_ITEM[item], visible);
    },
    [updateSetting],
  );

  const showAll = useCallback(() => {
    void updateSetting("hiddenSidebarActivityItems", []);
    for (const setting of Object.values(VISIBILITY_SETTING_BY_ITEM)) {
      void updateSetting(setting, true);
    }
  }, [updateSetting]);

  const hasHiddenItems =
    hiddenNavigationItemIds.length > 0 ||
    !projectSwitcher ||
    !agentHistory ||
    (coreFeatures.terminal && !terminals) ||
    (coreFeatures.git && !worktrees) ||
    !projectDots;

  return {
    hiddenNavigationItemIds,
    projectSwitcher,
    agentHistory,
    terminals,
    worktrees,
    projectDots,
    hasHiddenItems,
    setNavigationItemVisible,
    setItemVisible,
    showAll,
  };
}

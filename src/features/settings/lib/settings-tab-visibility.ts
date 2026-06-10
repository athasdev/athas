import type { SettingsAccess } from "./settings-access";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";

export function filterVisibleSettingsTabs<T extends { id: SettingsTab }>(
  tabs: T[],
  params: SettingsAccess & {
    matchingTabs?: Set<SettingsTab> | null;
  },
) {
  return tabs.filter((item) => {
    if (!params.canShowEnterpriseSettings && item.id === "enterprise") {
      return false;
    }

    if (!params.canShowCollaborationSettings && item.id === "collaboration") {
      return false;
    }

    if (!params.matchingTabs) {
      return true;
    }

    return params.matchingTabs.has(item.id);
  });
}

import type { SettingsTab } from "@/features/window/stores/ui-state-store";

export function filterVisibleSettingsTabs<T extends { id: SettingsTab }>(
  tabs: T[],
  params: {
    hasEnterpriseAccess: boolean;
    hasTeamsAccess: boolean;
    matchingTabs?: Set<SettingsTab> | null;
  },
) {
  return tabs.filter((item) => {
    if (!params.hasEnterpriseAccess && item.id === "enterprise") {
      return false;
    }

    if (!params.hasTeamsAccess && item.id === "collaboration") {
      return false;
    }

    if (!params.matchingTabs) {
      return true;
    }

    return params.matchingTabs.has(item.id);
  });
}

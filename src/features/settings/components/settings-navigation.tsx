import type { ReactNode } from "react";
import {
  SETTINGS_TAB_GROUPS,
  type SettingsTabItem,
} from "@/features/settings/config/settings-tabs";
import type { SettingsTab } from "@/features/window/stores/ui-state/types/ui-state.types";
import { WorkbenchNavigation } from "@/ui/workbench";

interface SettingsNavigationProps {
  activeTab: SettingsTab;
  items: SettingsTabItem[];
  onTabChange: (tab: SettingsTab) => void;
  search: ReactNode;
  children: ReactNode;
}

export function SettingsNavigation({
  activeTab,
  items,
  onTabChange,
  search,
  children,
}: SettingsNavigationProps) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const groups = SETTINGS_TAB_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.tabs.flatMap((tab) => {
      const item = itemsById.get(tab);
      if (!item) return [];
      const Icon = item.icon;
      return [
        {
          id: item.id,
          label: item.label,
          icon: <Icon />,
          tabId: `settings-tab-${item.id}`,
          panelId: `settings-panel-${item.id}`,
        },
      ];
    }),
  }));

  return (
    <WorkbenchNavigation
      title="Settings"
      search={search}
      groups={groups}
      value={activeTab}
      onValueChange={onTabChange}
      ariaLabel="Settings sections"
    >
      {children}
    </WorkbenchNavigation>
  );
}

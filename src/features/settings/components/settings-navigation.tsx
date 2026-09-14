import type { ReactNode } from "react";
import type { SettingsTabItem } from "@/features/settings/config/settings-tabs";
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
  const navigationItems = items.map((item) => {
    const Icon = item.icon;
    return {
      id: item.id,
      label: item.label,
      icon: <Icon />,
      tabId: `settings-tab-${item.id}`,
      panelId: `settings-panel-${item.id}`,
    };
  });

  return (
    <WorkbenchNavigation
      title="Settings"
      search={search}
      groups={[{ id: "settings", items: navigationItems }]}
      value={activeTab}
      onValueChange={onTabChange}
      ariaLabel="Settings pages"
    >
      {children}
    </WorkbenchNavigation>
  );
}

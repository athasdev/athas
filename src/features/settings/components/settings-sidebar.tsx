import { useCallback } from "react";
import {
  resolveSettingsAccess,
  resolveVisibleSettingsSection,
} from "@/features/settings/lib/settings-access";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state.store";
import { SidebarWorkspace } from "@/ui/sidebar";
import { SettingsVerticalTabs } from "./settings-vertical-tabs";

export function SettingsSidebar() {
  const settingsInitialTab = useUIState((state) => state.settingsInitialTab);
  const settingsInitialSection = useUIState((state) => state.settingsInitialSection);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const subscription = useAuthStore((state) => state.subscription);
  const { canShowCollaborationSettings, canShowEnterpriseSettings } =
    resolveSettingsAccess(subscription);
  const resolveVisibleTab = useCallback(
    (tab: SettingsTab) =>
      resolveVisibleSettingsSection(tab, {
        canShowCollaborationSettings,
        canShowEnterpriseSettings,
      }),
    [canShowCollaborationSettings, canShowEnterpriseSettings],
  );
  const activeTab = resolveVisibleTab(settingsInitialTab ?? lastSettingsTab);

  const handleTabChange = (tab: SettingsTab) => {
    const nextTab = resolveVisibleTab(tab);
    void updateSetting("lastSettingsTab", nextTab);
    openSettingsDialog(nextTab);
  };

  const handleSectionChange = (tab: SettingsTab, section: string) => {
    const nextTab = resolveVisibleTab(tab);
    void updateSetting("lastSettingsTab", nextTab);
    openSettingsDialog(nextTab, section);
  };

  return (
    <SidebarWorkspace title="Settings">
      <SettingsVerticalTabs
        activeTab={activeTab}
        activeSection={settingsInitialSection}
        onTabChange={handleTabChange}
        onSectionChange={handleSectionChange}
      />
    </SidebarWorkspace>
  );
}

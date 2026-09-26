import { useCallback, useMemo } from "react";
import { SETTINGS_TAB_ITEMS } from "@/features/settings/config/settings-tabs";
import {
  resolveSettingsAccess,
  resolveVisibleSettingsSection,
} from "@/features/settings/lib/settings-access";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { SearchResult } from "@/features/settings/types/search.types";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { SettingsTab } from "@/features/window/stores/ui-state/types/ui-state.types";
import { useUIState } from "@/features/window/stores/ui-state.store";

/**
 * The Settings page state shared by its sidebar navigation and the page in the main view: which
 * page is open, which pages this account can see, and the settings search.
 */
export function useSettingsPage() {
  const requestedTab = useUIState((state) => state.settingsInitialTab);
  const setSettingsInitialTab = useUIState((state) => state.setSettingsInitialTab);
  const setSettingsInitialSection = useUIState((state) => state.setSettingsInitialSection);
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const subscription = useAuthStore((state) => state.subscription);
  const settingsAccess = resolveSettingsAccess(subscription);
  const { canShowCollaborationSettings, canShowEnterpriseSettings } = settingsAccess;

  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const selectedResultId = useSettingsStore((state) => state.search.selectedResultId);
  const setSearchQuery = useSettingsStore((state) => state.actions.setSearchQuery);
  const selectSearchResult = useSettingsStore((state) => state.actions.selectSearchResult);

  const resolveVisibleTab = useCallback(
    (tab: SettingsTab) =>
      resolveVisibleSettingsSection(tab, {
        canShowCollaborationSettings,
        canShowEnterpriseSettings,
      }),
    [canShowCollaborationSettings, canShowEnterpriseSettings],
  );

  const activeTab = resolveVisibleTab(requestedTab ?? lastSettingsTab);
  const visibleTabs = useMemo(
    () =>
      filterVisibleSettingsTabs(SETTINGS_TAB_ITEMS, {
        canShowCollaborationSettings,
        canShowEnterpriseSettings,
        matchingTabs: null,
      }),
    [canShowCollaborationSettings, canShowEnterpriseSettings],
  );
  const visibleSearchResults = useMemo(
    () => searchResults.filter((result) => resolveVisibleTab(result.tab) === result.tab),
    [resolveVisibleTab, searchResults],
  );

  const selectTab = useCallback(
    (tab: SettingsTab) => {
      const nextTab = resolveVisibleTab(tab);
      setSettingsInitialTab(nextTab);
      void updateSetting("lastSettingsTab", nextTab);
    },
    [resolveVisibleTab, setSettingsInitialTab, updateSetting],
  );

  const openSearchResult = useCallback(
    (result: SearchResult) => {
      const nextTab = resolveVisibleTab(result.tab);
      if (nextTab !== result.tab) return;
      setSettingsInitialTab(nextTab);
      setSettingsInitialSection(result.section);
      void updateSetting("lastSettingsTab", nextTab);
      selectSearchResult(result.id);
    },
    [
      resolveVisibleTab,
      selectSearchResult,
      setSettingsInitialSection,
      setSettingsInitialTab,
      updateSetting,
    ],
  );

  return {
    activeTab,
    visibleTabs,
    selectTab,
    canShowCollaborationSettings,
    canShowEnterpriseSettings,
    searchQuery,
    setSearchQuery,
    searchResults: visibleSearchResults,
    selectedResultId,
    openSearchResult,
  };
}

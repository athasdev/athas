import { SharingSettings } from "@/features/sharing/components/sharing-settings";
import { useEffect, useMemo, useRef } from "react";
import type { SettingsTabItem } from "@/features/settings/config/settings-tabs";
import { useSettingsPage } from "@/features/settings/hooks/use-settings-page";
import {
  getSettingSearchTargetKey,
  SETTINGS_SEARCH_TAB_LABELS,
} from "@/features/settings/lib/settings-search";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { SettingsSection } from "@/features/settings/types/settings.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Empty, EmptyDescription } from "@/ui/empty";
import { SearchField } from "@/ui/search";
import { SidebarListItem } from "@/ui/sidebar";
import {
  Workbench,
  WorkbenchContent,
  WorkbenchNavigation,
  type WorkbenchNavigationGroup,
} from "@/ui/workbench";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AccountSettings } from "./tabs/account-settings";
import { AISettings } from "./tabs/ai-settings";
import { AppearanceSettings } from "./tabs/appearance-settings";
import { CollaborationSettings } from "./tabs/collaboration-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { EnterpriseSettings } from "./tabs/enterprise-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { GitSettings } from "./tabs/git-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { NotificationsSettings } from "./tabs/notifications-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

const SETTINGS_NAVIGATION_GROUPS: Array<{ id: string; label?: string; tabs: SettingsSection[] }> = [
  { id: "app", tabs: ["general", "appearance", "notifications", "keyboard"] },
  { id: "code", label: "Code", tabs: ["editor", "file-explorer", "terminal", "git", "ai"] },
  {
    id: "account",
    label: "Account",
    tabs: ["account", "sharing", "collaboration", "enterprise"],
  },
  { id: "advanced", tabs: ["advanced"] },
];

function groupSettingsTabs(tabs: SettingsTabItem[]): WorkbenchNavigationGroup<SettingsSection>[] {
  const toItem = (tab: SettingsTabItem) => {
    const Icon = tab.icon;
    return {
      id: tab.id,
      label: tab.label,
      icon: <Icon />,
      tabId: `settings-tab-${tab.id}`,
      panelId: `settings-panel-${tab.id}`,
    };
  };
  const grouped = new Set(SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.tabs));
  const groups = SETTINGS_NAVIGATION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.tabs.flatMap((id) => {
      const tab = tabs.find((item) => item.id === id);
      return tab ? [toItem(tab)] : [];
    }),
  }));
  const ungrouped = tabs.filter((tab) => !grouped.has(tab.id)).map(toItem);
  return ungrouped.length > 0 ? [...groups, { id: "other", items: ungrouped }] : groups;
}

/**
 * The Settings page, opened as one tab in the main view with its own page list and search, so
 * the workbench sidebar keeps showing whatever the user had open.
 */
const SettingsWorkbenchView = () => {
  const settingsInitialSection = useUIState((state) => state.settingsInitialSection);
  const settingsNavigationRequestId = useUIState((state) => state.settingsNavigationRequestId);
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const clearSearch = useSettingsStore((state) => state.actions.clearSearch);
  const {
    activeTab,
    visibleTabs,
    selectTab,
    canShowCollaborationSettings,
    canShowEnterpriseSettings,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedResultId,
    openSearchResult,
  } = useSettingsPage();
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationGroups = useMemo(() => groupSettingsTabs(visibleTabs), [visibleTabs]);
  const isSearching = searchQuery.trim().length > 0;

  // Pages opened directly (openSettings("ai")) become the page Settings reopens on.
  useEffect(() => {
    if (activeTab !== lastSettingsTab) void updateSetting("lastSettingsTab", activeTab);
  }, [activeTab, lastSettingsTab, updateSetting]);

  useEffect(() => () => clearSearch(), [clearSearch]);

  useEffect(() => {
    if (!settingsInitialSection) return;

    const frameId = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;

      const sectionKey = getSettingSearchTargetKey(settingsInitialSection);
      const section = content.querySelector<HTMLElement>(
        `[data-settings-section-key="${sectionKey}"]`,
      );
      if (!section) return;

      section.scrollIntoView({ block: "start", inline: "nearest" });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, settingsInitialSection, settingsNavigationRequestId]);

  useEffect(() => {
    const clearSearchHighlights = () => {
      const content = contentRef.current;
      if (!content) return;

      content
        .querySelectorAll<HTMLElement>("[data-settings-search-active='true']")
        .forEach((element) => element.removeAttribute("data-settings-search-active"));
      content
        .querySelectorAll<HTMLElement>("[data-settings-search-section-active='true']")
        .forEach((element) => element.removeAttribute("data-settings-search-section-active"));
    };

    if (!selectedResultId) {
      clearSearchHighlights();
      return;
    }

    const result = searchResults.find((item) => item.id === selectedResultId);
    if (!result || result.tab !== activeTab) {
      clearSearchHighlights();
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;

      const sectionKey = getSettingSearchTargetKey(result.section);
      const rowKey = getSettingSearchTargetKey(result.label);
      const section = content.querySelector<HTMLElement>(
        `[data-settings-section-key="${sectionKey}"]`,
      );
      const target =
        section?.querySelector<HTMLElement>(`[data-setting-row-key="${rowKey}"]`) ?? section;

      if (!target) return;

      clearSearchHighlights();
      section?.setAttribute("data-settings-search-section-active", "true");
      target.setAttribute("data-settings-search-active", "true");
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, selectedResultId, searchResults]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollLeft = 0;
  }, [activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "account":
        return <AccountSettings />;
      case "sharing":
        return <SharingSettings />;
      case "notifications":
        return <NotificationsSettings />;
      case "general":
        return <GeneralSettings />;
      case "editor":
        return <EditorSettings />;
      case "git":
        return <GitSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "ai":
        return <AISettings />;
      case "keyboard":
        return <KeyboardSettings />;
      case "collaboration":
        return canShowCollaborationSettings ? <CollaborationSettings /> : <GeneralSettings />;
      case "enterprise":
        return canShowEnterpriseSettings ? <EnterpriseSettings /> : <GeneralSettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "terminal":
        return <TerminalSettings />;
      case "file-explorer":
        return <FileTreeSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  const activePanelId = `settings-panel-${activeTab}`;
  const activeTabItem = visibleTabs.find((item) => item.id === activeTab) ?? visibleTabs[0];

  const search = (
    <SearchField
      value={searchQuery}
      onChange={setSearchQuery}
      placeholder="Search settings"
      aria-label="Search settings"
      autoFocus
      onKeyDown={(event) => {
        if (event.key === "Escape" && isSearching) {
          event.preventDefault();
          setSearchQuery("");
          return;
        }
        if (event.key !== "Enter") return;
        const firstResult = searchResults[0];
        if (!firstResult) return;
        event.preventDefault();
        openSearchResult(firstResult);
      }}
    />
  );

  const searchResultsList = isSearching ? (
    searchResults.length > 0 ? (
      <div className="flex flex-col gap-0.5" role="list" aria-label="Matching settings">
        {searchResults.map((result) => (
          <SidebarListItem
            key={result.id}
            active={selectedResultId === result.id}
            description={`${SETTINGS_SEARCH_TAB_LABELS[result.tab]} / ${result.section}`}
            onClick={() => openSearchResult(result)}
          >
            {result.label}
          </SidebarListItem>
        ))}
      </div>
    ) : (
      <Empty variant="inline" className="px-2 py-1.5">
        <EmptyDescription>No matching settings</EmptyDescription>
      </Empty>
    )
  ) : undefined;

  return (
    <Workbench>
      <WorkbenchNavigation
        title="Settings"
        search={search}
        body={searchResultsList}
        groups={navigationGroups}
        value={activeTab}
        onValueChange={selectTab}
        ariaLabel="Settings pages"
      >
        <WorkbenchContent
          title={activeTabItem?.label ?? "Settings"}
          description={activeTabItem?.description}
          pinnedHeader
          viewportProps={{
            ref: contentRef,
            id: activePanelId,
            role: "region",
            "aria-label": `${activeTabItem?.label ?? "Settings"} settings`,
            "data-settings-content": "",
          }}
        >
          <div className="@container/settings">{renderTabContent()}</div>
        </WorkbenchContent>
      </WorkbenchNavigation>
    </Workbench>
  );
};

export default SettingsWorkbenchView;

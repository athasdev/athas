import { MagnifyingGlassIcon as Search } from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_TAB_ITEMS } from "@/features/settings/config/settings-tabs";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  resolveSettingsAccess,
  resolveVisibleSettingsSection,
} from "@/features/settings/lib/settings-access";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import {
  getSettingSearchTargetKey,
  SETTINGS_SEARCH_TAB_LABELS,
} from "@/features/settings/lib/settings-search";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state.store";
import { ChromeBar } from "@/ui/chrome";
import { Dropdown } from "@/ui/dropdown";
import { Empty, EmptyDescription } from "@/ui/empty";
import Input from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import type { SearchResult } from "../types/search.types";

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
import { TerminalSettings } from "./tabs/terminal-settings";

const SettingsWorkbenchView = () => {
  const {
    settingsInitialTab,
    settingsInitialSection,
    settingsNavigationRequestId,
    setSettingsInitialTab,
    setSettingsInitialSection,
    activeSidebarView,
    setActiveView,
  } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const subscription = useAuthStore((state) => state.subscription);
  const settingsAccess = resolveSettingsAccess(subscription);
  const { canShowEnterpriseSettings, canShowCollaborationSettings } = settingsAccess;

  const clearSearch = useSettingsStore((state) => state.actions.clearSearch);
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const selectedResultId = useSettingsStore((state) => state.search.selectedResultId);
  const selectSearchResult = useSettingsStore((state) => state.actions.selectSearchResult);
  const setSearchQuery = useSettingsStore((state) => state.actions.setSearchQuery);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputAnchorRef = useRef<HTMLDivElement>(null);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  useEffect(() => {
    if (activeSidebarView === "settings") setActiveView("files");
  }, [activeSidebarView, setActiveView]);

  const resolveVisibleTab = useCallback(
    (tab: SettingsTab) =>
      resolveVisibleSettingsSection(tab, {
        canShowCollaborationSettings,
        canShowEnterpriseSettings,
      }),
    [canShowCollaborationSettings, canShowEnterpriseSettings],
  );
  const visibleSearchResults = useMemo(
    () => searchResults.filter((result) => resolveVisibleTab(result.tab) === result.tab),
    [resolveVisibleTab, searchResults],
  );
  const visibleSearchDropdownResults = visibleSearchResults.slice(0, 12);
  const visibleTabs = filterVisibleSettingsTabs(SETTINGS_TAB_ITEMS, {
    ...settingsAccess,
    matchingTabs: null,
  });
  useEffect(() => {
    const requestedTab = settingsInitialTab ?? lastSettingsTab;
    const nextTab = resolveVisibleTab(requestedTab);
    setActiveTab(nextTab);
    void updateSetting("lastSettingsTab", nextTab);
  }, [
    settingsInitialTab,
    lastSettingsTab,
    canShowEnterpriseSettings,
    canShowCollaborationSettings,
    updateSetting,
  ]);

  const handleTabChange = (tab: SettingsTab) => {
    const nextTab = resolveVisibleTab(tab);
    setActiveTab(nextTab);
    setSettingsInitialTab(nextTab);
    void updateSetting("lastSettingsTab", nextTab);
  };

  const navigateToSearchResult = useCallback(
    (result: SearchResult) => {
      const nextTab = resolveVisibleTab(result.tab);
      if (nextTab !== result.tab) return;

      setActiveTab(nextTab);
      setSettingsInitialTab(nextTab);
      setSettingsInitialSection(result.section);
      void updateSetting("lastSettingsTab", nextTab);
      selectSearchResult(result.id);
      setIsSearchDropdownOpen(false);
    },
    [
      resolveVisibleTab,
      selectSearchResult,
      setSettingsInitialSection,
      setSettingsInitialTab,
      updateSetting,
    ],
  );
  useEffect(
    () => () => {
      clearSearch();
    },
    [clearSearch],
  );

  useEffect(() => {
    if (!settingsInitialSection) return;

    let revealFrameId: number | undefined;
    const frameId = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;

      const sectionKey = getSettingSearchTargetKey(settingsInitialSection);
      const section = content.querySelector<HTMLElement>(
        `[data-settings-section-key="${sectionKey}"]`,
      );
      if (!section) return;

      const revealSection = () => {
        section.scrollIntoView({ block: "start", inline: "nearest" });
      };
      const sectionTrigger = section.querySelector<HTMLElement>("[data-settings-section-trigger]");

      if (sectionTrigger?.getAttribute("aria-expanded") === "false") {
        sectionTrigger.click();
        revealFrameId = window.requestAnimationFrame(revealSection);
      } else {
        revealSection();
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (revealFrameId !== undefined) window.cancelAnimationFrame(revealFrameId);
    };
  }, [activeTab, settingsInitialSection, settingsNavigationRequestId]);

  useEffect(() => {
    let revealFrameId: number | undefined;

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

    const result = visibleSearchResults.find((item) => item.id === selectedResultId);
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

      const revealTarget = () => {
        target.scrollIntoView({ block: "center", inline: "nearest" });
        target.focus({ preventScroll: true });
      };
      const sectionTrigger = section?.querySelector<HTMLElement>("[data-settings-section-trigger]");

      if (sectionTrigger?.getAttribute("aria-expanded") === "false") {
        sectionTrigger.click();
        revealFrameId = window.requestAnimationFrame(revealTarget);
      } else {
        revealTarget();
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (revealFrameId !== undefined) window.cancelAnimationFrame(revealFrameId);
    };
  }, [activeTab, selectedResultId, visibleSearchResults]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollLeft = 0;
  }, [activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "account":
        return <AccountSettings />;
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
  const activeTabId = `settings-tab-${activeTab}`;

  const searchInput = (
    <div ref={searchInputAnchorRef} className="w-56 shrink-0 max-[720px]:w-44 max-[520px]:w-32">
      <Input
        type="text"
        placeholder="Search settings..."
        value={searchQuery}
        onChange={(event) => {
          setSearchQuery(event.target.value);
          setIsSearchDropdownOpen(event.target.value.trim().length > 0);
        }}
        onFocus={() => {
          if (searchQuery.trim()) setIsSearchDropdownOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsSearchDropdownOpen(false);
            return;
          }

          if (event.key !== "Enter") return;
          const firstResult = visibleSearchResults[0];
          if (!firstResult) return;
          event.preventDefault();
          navigateToSearchResult(firstResult);
        }}
        leftIcon={Search}
        shape="pill"
        className="w-full"
      />
    </div>
  );

  return (
    <>
      <div className="@container/settings flex size-full min-w-0 flex-col overflow-hidden bg-background">
        <ChromeBar region="content" emphasis="primary" className="min-w-0 bg-background">
          <Tabs
            value={activeTab}
            onValueChange={(value) => handleTabChange(value as SettingsTab)}
            className="min-w-0 flex-1 gap-0"
          >
            <div className="scrollbar-none min-w-0 overflow-x-auto">
              <TabsList variant="bare" aria-label="Settings sections">
                {visibleTabs.map((item) => {
                  const Icon = item.icon;

                  return (
                    <TabsTrigger
                      key={item.id}
                      id={`settings-tab-${item.id}`}
                      value={item.id}
                      aria-controls={`settings-panel-${item.id}`}
                      className="w-fit flex-none"
                    >
                      <Icon weight="duotone" />
                      <span>{item.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </Tabs>
          {searchInput}
        </ChromeBar>

        <ScrollArea
          orientation="vertical"
          className="min-h-0 min-w-0 flex-1"
          contentClassName="mx-auto min-h-full w-full max-w-4xl overflow-x-hidden px-6 py-4 max-[720px]:px-3 max-[720px]:py-2"
          viewportProps={{
            ref: contentRef,
            id: activePanelId,
            role: "tabpanel",
            "aria-labelledby": activeTabId,
            "data-settings-content": "",
          }}
        >
          {renderTabContent()}
        </ScrollArea>
      </div>
      <Dropdown
        isOpen={isSearchDropdownOpen && searchQuery.trim().length > 0}
        anchorRef={searchInputAnchorRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={() => setIsSearchDropdownOpen(false)}
        matchAnchorWidth
        className="min-w-0"
      >
        <div className="max-h-80 overflow-y-auto p-1">
          {visibleSearchDropdownResults.length > 0 ? (
            visibleSearchDropdownResults.map((result) => {
              const isSelected = selectedResultId === result.id;

              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => navigateToSearchResult(result)}
                  className={[
                    "font-sans flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                  ].join(" ")}
                >
                  <span className="ui-text-base w-full truncate font-medium">{result.label}</span>
                  <span className="ui-text-sm w-full truncate text-subtle-foreground">
                    {SETTINGS_SEARCH_TAB_LABELS[result.tab]} / {result.section}
                  </span>
                </button>
              );
            })
          ) : (
            <Empty className="min-h-0 flex-none items-start rounded-none px-3 py-2 text-left">
              <EmptyDescription>No matching settings</EmptyDescription>
            </Empty>
          )}
        </div>
      </Dropdown>
    </>
  );
};

export default SettingsWorkbenchView;

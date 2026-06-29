import { CaretDownIcon as CaretDown, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Dialog from "@/ui/dialog";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Input from "@/ui/input";
import type { SearchResult } from "../types/search.types";
import { SETTINGS_TAB_ITEMS, SettingsVerticalTabs } from "./settings-vertical-tabs";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AccountSettings } from "./tabs/account-settings";
import { AISettings } from "./tabs/ai-settings";
import { AppearanceSettings } from "./tabs/appearance-settings";
import { CollaborationSettings } from "./tabs/collaboration-settings";
import { DatabaseSettings } from "./tabs/database-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { EnterpriseSettings } from "./tabs/enterprise-settings";
import { ExtensionsSettings } from "./tabs/extensions-settings";
import { FeaturesSettings } from "./tabs/features-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { GitSettings } from "./tabs/git-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { settingsInitialTab, setSettingsInitialTab } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const lastSettingsTab = useSettingsStore((state) => state.settings.lastSettingsTab);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const subscription = useAuthStore((state) => state.subscription);
  const settingsAccess = resolveSettingsAccess(subscription);
  const { canShowEnterpriseSettings, canShowCollaborationSettings } = settingsAccess;

  const clearSearch = useSettingsStore((state) => state.clearSearch);
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const selectedResultId = useSettingsStore((state) => state.search.selectedResultId);
  const selectSearchResult = useSettingsStore((state) => state.selectSearchResult);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputAnchorRef = useRef<HTMLDivElement>(null);
  const tabDropdownRef = useRef<HTMLButtonElement>(null);
  const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
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
  const activeTabItem =
    visibleTabs.find((tab) => tab.id === activeTab) ??
    SETTINGS_TAB_ITEMS.find((tab) => tab.id === activeTab) ??
    SETTINGS_TAB_ITEMS[0];
  const ActiveTabIcon = activeTabItem.icon;
  // Sync active tab with explicit requests, or fall back to the persisted last section.
  useEffect(() => {
    if (isOpen) {
      const requestedTab = settingsInitialTab ?? lastSettingsTab;
      const nextTab = resolveVisibleTab(requestedTab);
      setActiveTab(nextTab);
      void updateSetting("lastSettingsTab", nextTab);
    }
  }, [
    settingsInitialTab,
    lastSettingsTab,
    isOpen,
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
      selectSearchResult(result.id);
      setIsSearchDropdownOpen(false);
    },
    [resolveVisibleTab, selectSearchResult],
  );
  const tabMenuItems: MenuItem[] = visibleTabs.map((tab) => {
    const Icon = tab.icon;
    return {
      id: tab.id,
      label: tab.label,
      icon: <Icon className="size-4" weight="duotone" />,
      className: tab.id === activeTab ? "bg-hover text-text" : undefined,
      onClick: () => handleTabChange(tab.id),
    };
  });

  // Clear search when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clearSearch();
      setIsSearchDropdownOpen(false);
    }
  }, [isOpen, clearSearch]);

  useEffect(() => {
    if (!isOpen || !selectedResultId) return;

    const result = visibleSearchResults.find((item) => item.id === selectedResultId);
    if (!result || result.tab !== activeTab) return;

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

      content
        .querySelectorAll<HTMLElement>("[data-settings-search-active='true']")
        .forEach((element) => element.removeAttribute("data-settings-search-active"));
      target.setAttribute("data-settings-search-active", "true");
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });

      window.setTimeout(() => {
        target.removeAttribute("data-settings-search-active");
      }, 1600);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, isOpen, selectedResultId, visibleSearchResults]);

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
      case "databases":
        return <DatabaseSettings />;
      case "extensions":
        return <ExtensionsSettings />;
      case "ai":
        return <AISettings />;
      case "keyboard":
        return <KeyboardSettings />;
      case "features":
        return <FeaturesSettings />;
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

  if (!isOpen) return null;

  const activePanelId = `settings-panel-${activeTab}`;
  const activeTabId = `settings-tab-${activeTab}`;

  return (
    <>
      <Dialog
        onClose={onClose}
        title={
          <>
            <span className="max-[720px]:hidden">Settings</span>
            <button
              ref={tabDropdownRef}
              type="button"
              className="hidden h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-md border border-border/70 bg-secondary-bg/50 px-2 text-left text-text transition-colors hover:bg-hover max-[720px]:inline-flex"
              onClick={() => setIsTabDropdownOpen(true)}
            >
              <ActiveTabIcon className="size-4 shrink-0 text-text-lighter" weight="duotone" />
              <span className="truncate">{activeTabItem.label}</span>
              <CaretDown className="size-3.5 shrink-0 text-text-lighter" />
            </button>
          </>
        }
        headerActions={
          <div ref={searchInputAnchorRef} className="w-64 max-[720px]:w-44 max-[520px]:w-32">
            <Input
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchDropdownOpen(e.target.value.trim().length > 0);
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
              size="md"
              className="w-full"
            />
          </div>
        }
        classNames={{
          modal:
            "h-[74vh] max-h-[820px] w-[90vw] max-w-[1120px] min-w-0 border-0 max-[720px]:h-[86vh] max-[720px]:w-[calc(100vw-32px)] [&>div:first-child]:border-b-0",
          header: "max-[720px]:grid max-[720px]:grid-cols-[minmax(0,1fr)_auto] max-[720px]:gap-2",
          title: "max-[720px]:min-w-0",
          headerActions: "max-[720px]:min-w-0",
          content: "flex p-0",
        }}
      >
        <div className="flex size-full min-w-0 overflow-hidden">
          <div className="w-52 shrink-0 max-[720px]:hidden">
            <SettingsVerticalTabs
              activeTab={activeTab}
              onTabChange={handleTabChange}
              panelIdForTab={(tab) => `settings-panel-${tab}`}
            />
          </div>

          <div
            ref={contentRef}
            id={activePanelId}
            role="tabpanel"
            aria-labelledby={activeTabId}
            data-settings-content=""
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto p-3 [overscroll-behavior:contain] max-[720px]:p-2"
          >
            {renderTabContent()}
          </div>
        </div>
      </Dialog>
      <Dropdown
        isOpen={isTabDropdownOpen}
        anchorRef={tabDropdownRef}
        anchorSide="bottom"
        anchorAlign="start"
        items={tabMenuItems}
        onClose={() => setIsTabDropdownOpen(false)}
        className="w-fit min-w-44"
      />
      <Dropdown
        isOpen={isSearchDropdownOpen && searchQuery.trim().length > 0}
        anchorRef={searchInputAnchorRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={() => setIsSearchDropdownOpen(false)}
        matchAnchorWidth
        anchorMinWidth={260}
        className="min-w-64"
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
                    "ui-font flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected ? "bg-accent/10 text-accent" : "text-text hover:bg-hover",
                  ].join(" ")}
                >
                  <span className="ui-text-base w-full truncate font-medium">{result.label}</span>
                  <span className="ui-text-base w-full truncate text-text-lighter">
                    {SETTINGS_SEARCH_TAB_LABELS[result.tab]} / {result.section}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="ui-font ui-text-base px-3 py-2 text-text-lighter">
              No matching settings
            </div>
          )}
        </div>
      </Dropdown>
    </>
  );
};

export default SettingsDialog;

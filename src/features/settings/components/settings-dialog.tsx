import { CaretDown, MagnifyingGlass as Search } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state-store";
import Dialog from "@/ui/dialog";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Input from "@/ui/input";
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
  const subscription = useAuthStore((state) => state.subscription);
  const hasEnterpriseAccess = Boolean(subscription?.enterprise?.has_access);
  const hasTeamsAccess = Boolean(subscription?.collaboration?.enabled);

  const clearSearch = useSettingsStore((state) => state.clearSearch);
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabDropdownRef = useRef<HTMLButtonElement>(null);
  const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
  const matchingTabs = searchQuery ? new Set(searchResults.map((result) => result.tab)) : null;
  const visibleTabs = filterVisibleSettingsTabs(SETTINGS_TAB_ITEMS, {
    hasEnterpriseAccess,
    hasTeamsAccess,
    matchingTabs,
  });
  const activeTabItem =
    visibleTabs.find((tab) => tab.id === activeTab) ??
    SETTINGS_TAB_ITEMS.find((tab) => tab.id === activeTab) ??
    SETTINGS_TAB_ITEMS[0];
  const ActiveTabIcon = activeTabItem.icon;
  // Sync active tab with settingsInitialTab whenever it changes (enables deep linking when dialog is already open)
  useEffect(() => {
    if (isOpen) {
      if (settingsInitialTab === "language") {
        setActiveTab("editor");
      } else if (
        (!hasEnterpriseAccess && settingsInitialTab === "enterprise") ||
        (!hasTeamsAccess && settingsInitialTab === "collaboration")
      ) {
        setActiveTab("general");
      } else {
        setActiveTab(settingsInitialTab);
      }
    }
  }, [settingsInitialTab, isOpen, hasEnterpriseAccess, hasTeamsAccess]);

  // Remember the last active tab so it persists across open/close
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSettingsInitialTab(tab);
  };
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
    }
  }, [isOpen, clearSearch]);

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
        return hasTeamsAccess ? <CollaborationSettings /> : <GeneralSettings />;
      case "enterprise":
        return hasEnterpriseAccess ? <EnterpriseSettings /> : <GeneralSettings />;
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
          <Input
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={Search}
            size="sm"
            className="w-64 max-[720px]:w-44 max-[520px]:w-32"
          />
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
        <div className="flex h-full w-full min-w-0 overflow-hidden">
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
            className="min-w-0 flex-1 overflow-y-auto p-3 [--app-ui-control-font-size:var(--ui-text-sm)] [overscroll-behavior:contain] max-[720px]:p-2"
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
    </>
  );
};

export default SettingsDialog;

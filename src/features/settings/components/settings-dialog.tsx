import { MagnifyingGlass as Search } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state-store";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { SettingsVerticalTabs } from "./settings-vertical-tabs";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AccountSettings } from "./tabs/account-settings";
import { AISettings } from "./tabs/ai-settings";
import { AppearanceSettings } from "./tabs/appearance-settings";
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

  const clearSearch = useSettingsStore((state) => state.clearSearch);
  const searchQuery = useSettingsStore((state) => state.search.query);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync active tab with settingsInitialTab whenever it changes (enables deep linking when dialog is already open)
  useEffect(() => {
    if (isOpen) {
      if (settingsInitialTab === "language") {
        setActiveTab("editor");
      } else if (!hasEnterpriseAccess && settingsInitialTab === "enterprise") {
        setActiveTab("general");
      } else {
        setActiveTab(settingsInitialTab);
      }
    }
  }, [settingsInitialTab, isOpen, hasEnterpriseAccess]);

  // Remember the last active tab so it persists across open/close
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSettingsInitialTab(tab);
  };

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
    <Dialog
      onClose={onClose}
      title="Settings"
      headerActions={
        <Input
          type="text"
          placeholder="Search settings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          size="sm"
          className="w-64"
        />
      }
      classNames={{
        modal:
          "h-[74vh] max-h-[820px] w-[78vw] max-w-[1040px] border-0 [&>div:first-child]:border-b-0",
        content: "flex p-0",
      }}
    >
      <div className="flex h-full w-full overflow-hidden">
        <div className="w-52">
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
          className="flex-1 overflow-y-auto p-3 [--app-ui-control-font-size:var(--ui-text-sm)] [overscroll-behavior:contain]"
        >
          {renderTabContent()}
        </div>
      </div>
    </Dialog>
  );
};

export default SettingsDialog;

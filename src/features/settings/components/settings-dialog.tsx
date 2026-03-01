import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import { type SettingsTab, useUIState } from "@/stores/ui-state-store";
import Dialog from "@/ui/dialog";
import { SettingsVerticalTabs } from "./settings-vertical-tabs";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AISettings } from "./tabs/ai-settings";
import { AppearanceSettings } from "./tabs/appearance-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { EnterpriseSettings } from "./tabs/enterprise-settings";
import { ExtensionsSettings } from "./tabs/extensions-settings";
import { FeaturesSettings } from "./tabs/features-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { LanguageSettings } from "./tabs/language-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { settingsInitialTab } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const subscription = useAuthStore((state) => state.subscription);
  const hasEnterpriseAccess = Boolean(subscription?.enterprise?.has_access);

  const clearSearch = useSettingsStore((state) => state.clearSearch);

  // Sync active tab with settingsInitialTab whenever it changes (enables deep linking when dialog is already open)
  useEffect(() => {
    if (isOpen) {
      if (!hasEnterpriseAccess && settingsInitialTab === "enterprise") {
        setActiveTab("general");
      } else {
        setActiveTab(settingsInitialTab);
      }
    }
  }, [settingsInitialTab, isOpen, hasEnterpriseAccess]);

  // Clear search and reset tab when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clearSearch();
    }
  }, [isOpen, clearSearch]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "editor":
        return <EditorSettings />;
      case "appearance":
        return <AppearanceSettings />;
      case "extensions":
        return <ExtensionsSettings />;
      case "ai":
        return <AISettings />;
      case "keyboard":
        return <KeyboardSettings />;
      case "language":
        return <LanguageSettings />;
      case "features":
        return <FeaturesSettings />;
      case "enterprise":
        return hasEnterpriseAccess ? <EnterpriseSettings /> : <GeneralSettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "terminal":
        return <TerminalSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      onClose={onClose}
      title="Settings"
      classNames={{
        modal: "h-[80vh] max-h-[900px] w-[85vw] max-w-[1200px]",
        content: "flex p-0",
      }}
    >
      <div className="flex h-full w-full overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 border-border/50 border-r bg-secondary-bg/30">
          <SettingsVerticalTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-4">{renderTabContent()}</div>
      </div>
    </Dialog>
  );
};

export default SettingsDialog;

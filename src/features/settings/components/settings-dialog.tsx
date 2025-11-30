import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { type SettingsTab, useUIState } from "@/stores/ui-state-store";
import Dialog from "@/ui/dialog";
import { SettingsVerticalTabs } from "./settings-vertical-tabs";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AISettings } from "./tabs/ai-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { ExtensionsSettings } from "./tabs/extensions-settings";
import { FeaturesSettings } from "./tabs/features-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { LanguageSettings } from "./tabs/language-settings";
import { TerminalSettings } from "./tabs/terminal-settings";
import { ThemeSettings } from "./tabs/theme-settings";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { settingsInitialTab } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const clearSearch = useSettingsStore((state) => state.clearSearch);

  // Set the active tab to the initial tab when the dialog opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(settingsInitialTab);
    }
  }, [isOpen, settingsInitialTab]);

  // Clear search when dialog closes
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
      case "theme":
        return <ThemeSettings />;
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
      case "advanced":
        return <AdvancedSettings />;
      case "fileTree":
        return <FileTreeSettings />;
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
      <div className="flex h-full w-full">
        {/* Sidebar */}
        <div className="w-48 border-border border-r bg-secondary-bg">
          <SettingsVerticalTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-4">{renderTabContent()}</div>
      </div>
    </Dialog>
  );
};

export default SettingsDialog;

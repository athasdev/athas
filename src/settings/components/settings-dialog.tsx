import { useEffect, useState } from "react";

import Dialog from "@/components/ui/dialog";
import { type SettingsTab, useUIState } from "@/stores/ui-state-store";
import { SettingsVerticalTabs } from "./settings-vertical-tabs";

import { AdvancedSettings } from "./tabs/advanced-settings";
import { AISettings } from "./tabs/ai-settings";
import { EditorSettings } from "./tabs/editor-settings";
import { FeaturesSettings } from "./tabs/features-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { KeyboardSettings } from "./tabs/keyboard-settings";
import { LanguageSettings } from "./tabs/language-settings";
import { ThemeSettings } from "./tabs/theme-settings";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { settingsInitialTab } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // Set the active tab to the initial tab when the dialog opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(settingsInitialTab);
    }
  }, [isOpen, settingsInitialTab]);

  // Handle Escape key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralSettings />;
      case "editor":
        return <EditorSettings />;
      case "theme":
        return <ThemeSettings />;
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
      default:
        return <GeneralSettings />;
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      onClose={onClose}
      title="Settings"
      classNames={{ modal: "h-[600px] max-h-[90vh] w-[800px] max-w-[90vw]" }}
    >
      {/* Sidebar with vertical tabs */}
      <div className="w-40 border-border border-r bg-secondary-bg">
        <SettingsVerticalTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto p-4">{renderTabContent()}</div>
    </Dialog>
  );
};

export default SettingsDialog;

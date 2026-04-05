import { ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
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
import { LanguageSettings } from "./tabs/language-settings";
import { FileTreeSettings } from "./tabs/file-tree-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  account: "Account",
  general: "General",
  editor: "Editor",
  git: "Git",
  appearance: "Appearance",
  databases: "Databases",
  extensions: "Extensions",
  ai: "AI",
  keyboard: "Keybindings",
  language: "Language",
  features: "Features",
  enterprise: "Enterprise",
  advanced: "Advanced",
  terminal: "Terminal",
  "file-explorer": "File Explorer",
};

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { settingsInitialTab, setSettingsInitialTab } = useUIState();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [activeSection, setActiveSection] = useState<string>("");
  const subscription = useAuthStore((state) => state.subscription);
  const hasEnterpriseAccess = Boolean(subscription?.enterprise?.has_access);

  const clearSearch = useSettingsStore((state) => state.clearSearch);
  const searchQuery = useSettingsStore((state) => state.search.query);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Remember the last active tab so it persists across open/close
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSettingsInitialTab(tab);
    setActiveSection("");
  };

  // Clear search when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clearSearch();
    }
  }, [isOpen, clearSearch]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const syncActiveSection = () => {
      const sections = Array.from(
        container.querySelectorAll<HTMLElement>("[data-settings-section]"),
      );

      if (sections.length === 0) {
        setActiveSection("");
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      let current = sections[0].dataset.settingsSection || "";

      for (const section of sections) {
        const sectionTop = section.getBoundingClientRect().top - containerTop;
        if (sectionTop <= 56) {
          current = section.dataset.settingsSection || current;
        } else {
          break;
        }
      }

      setActiveSection(current);
    };

    syncActiveSection();
    container.addEventListener("scroll", syncActiveSection, { passive: true });
    const raf = requestAnimationFrame(syncActiveSection);

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("scroll", syncActiveSection);
    };
  }, [activeTab, isOpen, searchQuery]);

  const scrollContentToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setActiveSection("");
  }, []);

  const scrollToSection = useCallback((sectionTitle: string) => {
    const container = contentRef.current;
    if (!container) return;

    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-settings-section]"));
    const target = sections.find((section) => section.dataset.settingsSection === sectionTitle);
    if (!target) return;

    container.scrollTo({ top: target.offsetTop - 8, behavior: "smooth" });
    setActiveSection(sectionTitle);
  }, []);

  const dialogTitle = useMemo(() => {
    const crumbs: Array<{ label: string; onClick: () => void }> = [
      {
        label: "Settings",
        onClick: () => {
          handleTabChange("general");
          scrollContentToTop();
        },
      },
      {
        label: SETTINGS_TAB_LABELS[activeTab],
        onClick: scrollContentToTop,
      },
    ];
    if (activeSection) {
      crumbs.push({
        label: activeSection,
        onClick: () => scrollToSection(activeSection),
      });
    }

    return (
      <div className="ui-font flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none text-text-lighter">
        {crumbs.map((crumb, index) => (
          <div key={crumb.label} className="flex min-w-0 shrink-0 items-center gap-0.5">
            {index > 0 ? (
              <ChevronRight className="mx-0.5 size-3.5 shrink-0 text-text-lighter" />
            ) : null}
            <Button
              onClick={crumb.onClick}
              variant="ghost"
              size="xs"
              className={cn(
                "ui-text-sm min-w-0 gap-1 whitespace-nowrap rounded px-1 py-0.5",
                index === crumbs.length - 1
                  ? "font-medium text-text hover:text-text"
                  : "text-text-lighter hover:text-text",
              )}
              title={crumb.label}
            >
              <span className="truncate">{crumb.label}</span>
            </Button>
          </div>
        ))}
      </div>
    );
  }, [activeSection, activeTab, scrollContentToTop, scrollToSection]);

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
      case "file-explorer":
        return <FileTreeSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      onClose={onClose}
      title={dialogTitle}
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
          "h-[80vh] max-h-[900px] w-[85vw] max-w-[1200px] border-0 [&>div:first-child]:border-b-0",
        content: "flex p-0",
      }}
    >
      <div className="flex h-full w-full overflow-hidden">
        {/* Sidebar */}
        <div className="w-52">
          <SettingsVerticalTabs activeTab={activeTab} onTabChange={handleTabChange} />
        </div>

        {/* Main content area */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 [overscroll-behavior:contain]">
          {renderTabContent()}
        </div>
      </div>
    </Dialog>
  );
};

export default SettingsDialog;

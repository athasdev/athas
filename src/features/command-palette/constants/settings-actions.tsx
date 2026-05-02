import {
  WarningCircle as AlertCircle,
  CaretRight as ChevronRight,
  Cloud,
  Code as Code2,
  GitBranch,
  Hash,
  Info,
  Translate as Languages,
  Lightbulb,
  ChatCircleText as MessageSquare,
  Palette,
  FloppyDisk as Save,
  MagnifyingGlass as Search,
  GearSix as Settings,
  Sparkle as Sparkles,
  TerminalWindow as Terminal,
  TextAlignJustify as WrapText,
} from "@phosphor-icons/react";
import { settingsSearchIndex } from "@/features/settings/config/search-index";
import type { Settings as AppSettings } from "@/features/settings/store";
import type { SettingsTab } from "@/features/window/stores/ui-state-store";
import { scoreSearchQuery } from "@/utils/search-match";
import type { Action } from "../models/action.types";

interface SettingsActionsParams {
  query: string;
  settings: AppSettings;
  setIsSettingsDialogVisible: (v: boolean) => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  setSettingsSearchQuery: (query: string) => void;
  setIsThemeSelectorVisible: (v: boolean) => void;
  setIsIconThemeSelectorVisible: (v: boolean) => void;
  updateSetting: (key: string, value: any) => void | Promise<void>;
  handleFileSelect: ((path: string, isDir: boolean) => void) | undefined;
  getAppDataDir: () => Promise<string>;
  openWhatsNew: () => void | Promise<void>;
  openOnboarding: () => void | Promise<void>;
  onClose: () => void;
}

const settingsTabLabels: Record<SettingsTab, string> = {
  account: "Account",
  general: "General",
  editor: "Editor",
  git: "Git",
  appearance: "Appearance",
  databases: "Database",
  extensions: "Extensions",
  ai: "AI",
  keyboard: "Keybindings",
  language: "Editor",
  features: "Features",
  enterprise: "Enterprise",
  advanced: "Advanced",
  terminal: "Terminal",
  "file-explorer": "Files",
};

const settingsTabCommands = (Object.entries(settingsTabLabels) as Array<[SettingsTab, string]>)
  .map(([tab, label]) => ({ tab, label }))
  .filter(({ tab }) => tab !== "language");

function getMatchingSettingsRecords(query: string) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return [];

  return settingsSearchIndex
    .map((record) => {
      const score = scoreSearchQuery(trimmedQuery, [
        { value: record.label, weight: 11 },
        { value: record.description, weight: 1 },
        { value: record.section, weight: 1 },
        ...(record.keywords || []).map((keyword) => ({ value: keyword, weight: 6 })),
      ]);

      if (score === 0) return null;

      return { record, score };
    })
    .filter((entry): entry is { record: (typeof settingsSearchIndex)[number]; score: number } => {
      return entry !== null;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((entry) => entry.record);
}

export const createSettingsActions = (params: SettingsActionsParams): Action[] => {
  const {
    query,
    settings,
    setIsSettingsDialogVisible,
    openSettingsDialog,
    setSettingsSearchQuery,
    setIsThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
    updateSetting,
    handleFileSelect,
    getAppDataDir,
    openWhatsNew,
    openOnboarding,
    onClose,
  } = params;

  const openSettingsTabActions: Action[] = settingsTabCommands.map(({ tab, label }) => ({
    id: `open-settings-tab-${tab}`,
    label: `Preferences: Open ${label} Settings`,
    description: `Open the ${label.toLowerCase()} settings tab`,
    icon: <Settings />,
    category: "Settings",
    action: () => {
      onClose();
      setSettingsSearchQuery("");
      openSettingsDialog(tab);
    },
  }));

  const generatedSettingActions: Action[] = getMatchingSettingsRecords(query).map((record) => ({
    id: `open-setting-${record.id}`,
    label: `Settings: ${record.label}`,
    description: `Open ${settingsTabLabels[record.tab]} > ${record.label}`,
    icon: <Settings />,
    category: "Settings",
    action: () => {
      onClose();
      setSettingsSearchQuery(record.label);
      openSettingsDialog(record.tab);
    },
  }));

  return [
    {
      id: "open-settings",
      label: "Preferences: Open Settings",
      description: "Open settings dialog",
      icon: <Settings />,
      category: "Settings",
      action: () => {
        onClose();
        setIsSettingsDialogVisible(true);
      },
    },
    {
      id: "report-bug",
      label: "Help: Report a Bug",
      description: "Copy environment details and open the bug report page",
      icon: <AlertCircle />,
      category: "Settings",
      action: async () => {
        try {
          onClose();
          const { getVersion } = await import("@tauri-apps/api/app");
          const version = await getVersion();
          let osSummary = "";
          try {
            const os = await import("@tauri-apps/plugin-os");
            const plat = os.platform();
            const ver = os.version();
            osSummary = `${plat} ${ver}`;
          } catch {
            osSummary = navigator.userAgent;
          }

          const text = `Environment\n\n- App: Athas ${version}\n- OS: ${osSummary}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n`;

          try {
            const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
            await writeText(text);
          } catch {
            await navigator.clipboard.writeText(text);
          }

          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl("https://github.com/athasdev/athas/issues/new?template=01-bug.yml");
        } catch (e) {
          console.error("Failed to prepare bug report:", e);
        }
      },
    },
    {
      id: "show-whats-new",
      label: "Help: What's New",
      description: "Open the latest release notes for this version",
      icon: <Sparkles />,
      category: "Settings",
      action: () => {
        onClose();
        void openWhatsNew();
      },
    },
    {
      id: "open-onboarding",
      label: "Help: Open Onboarding",
      description: "Open the onboarding flow again",
      icon: <Sparkles />,
      category: "Settings",
      action: () => {
        onClose();
        void openOnboarding();
      },
    },
    {
      id: "open-settings-json",
      label: "Preferences: Open Settings JSON file",
      description: "Open settings JSON file",
      icon: <Settings />,
      category: "Settings",
      action: () => {
        onClose();
        getAppDataDir().then((path) => {
          if (handleFileSelect) {
            handleFileSelect(`${path}/settings.json`, false);
          }
        });
      },
    },
    {
      id: "color-theme",
      label: "Preferences: Color Theme",
      description: "Choose a color theme",
      icon: <Palette />,
      category: "Theme",
      commandId: "workbench.showThemeSelector",
      action: () => {
        onClose();
        setIsThemeSelectorVisible(true);
      },
    },
    {
      id: "icon-theme",
      label: "Preferences: Icon Theme",
      description: "Choose an icon theme",
      icon: <Palette />,
      category: "Theme",
      action: () => {
        onClose();
        setIsIconThemeSelectorVisible(true);
      },
    },
    {
      id: "toggle-vim-mode",
      label: settings.vimMode ? "Vim: Disable Vim Mode" : "Vim: Enable Vim keybindings",
      description: settings.vimMode ? "Switch to normal editing mode" : "Enable Vim keybindings",
      icon: <Terminal />,
      category: "Vim",
      action: () => {
        updateSetting("vimMode", !settings.vimMode);
        onClose();
      },
    },
    {
      id: "toggle-word-wrap",
      label: settings.wordWrap ? "Editor: Disable Word Wrap" : "Editor: Enable Word Wrap",
      description: settings.wordWrap
        ? "Disable line wrapping in editor"
        : "Wrap lines that exceed viewport width",
      icon: <WrapText />,
      category: "Editor",
      action: () => {
        updateSetting("wordWrap", !settings.wordWrap);
        onClose();
      },
    },
    {
      id: "toggle-line-numbers",
      label: settings.lineNumbers ? "Editor: Hide Line Numbers" : "Editor: Show Line Numbers",
      description: settings.lineNumbers
        ? "Hide line numbers in editor"
        : "Show line numbers in editor",
      icon: <Hash />,
      category: "Editor",
      action: () => {
        updateSetting("lineNumbers", !settings.lineNumbers);
        onClose();
      },
    },
    {
      id: "toggle-relative-line-numbers",
      label: settings.vimRelativeLineNumbers
        ? "Editor: Disable Relative Line Numbers"
        : "Editor: Enable Relative Line Numbers",
      description: settings.vimRelativeLineNumbers
        ? "Use absolute line numbers"
        : "Show relative line numbers (Vim mode)",
      icon: <Hash />,
      category: "Editor",
      action: () => {
        updateSetting("vimRelativeLineNumbers", !settings.vimRelativeLineNumbers);
        onClose();
      },
    },
    {
      id: "toggle-auto-save",
      label: settings.autoSave ? "General: Disable Auto Save" : "General: Enable Auto Save",
      description: settings.autoSave
        ? "Disable automatic file saving"
        : "Automatically save files when editing",
      icon: <Save />,
      category: "Settings",
      action: () => {
        updateSetting("autoSave", !settings.autoSave);
        onClose();
      },
    },
    {
      id: "toggle-auto-detect-language",
      label: settings.autoDetectLanguage
        ? "Language: Disable Auto-detect Language"
        : "Language: Enable Auto-detect Language",
      description: settings.autoDetectLanguage
        ? "Manually set language for files"
        : "Automatically detect file language from extension",
      icon: <Languages />,
      category: "Language",
      action: () => {
        updateSetting("autoDetectLanguage", !settings.autoDetectLanguage);
        onClose();
      },
    },
    {
      id: "toggle-format-on-save",
      label: settings.formatOnSave
        ? "Language: Disable Format on Save"
        : "Language: Enable Format on Save",
      description: settings.formatOnSave
        ? "Disable automatic formatting on save"
        : "Automatically format code when saving",
      icon: <Code2 />,
      category: "Language",
      action: () => {
        updateSetting("formatOnSave", !settings.formatOnSave);
        onClose();
      },
    },
    {
      id: "toggle-auto-completion",
      label: settings.autoCompletion
        ? "Language: Disable Auto Completion"
        : "Language: Enable Auto Completion",
      description: settings.autoCompletion
        ? "Disable completion suggestions"
        : "Show completion suggestions while typing",
      icon: <Lightbulb />,
      category: "Language",
      action: () => {
        updateSetting("autoCompletion", !settings.autoCompletion);
        onClose();
      },
    },
    {
      id: "toggle-parameter-hints",
      label: settings.parameterHints
        ? "Language: Disable Parameter Hints"
        : "Language: Enable Parameter Hints",
      description: settings.parameterHints
        ? "Disable function parameter hints"
        : "Show function parameter hints",
      icon: <Info />,
      category: "Language",
      action: () => {
        updateSetting("parameterHints", !settings.parameterHints);
        onClose();
      },
    },
    {
      id: "toggle-ai-completion",
      label: settings.aiCompletion ? "AI: Disable AI Completion" : "AI: Enable AI Completion",
      description: settings.aiCompletion
        ? "Disable AI-powered code completion"
        : "Enable AI-powered code completion",
      icon: <Sparkles />,
      category: "AI",
      action: () => {
        updateSetting("aiCompletion", !settings.aiCompletion);
        onClose();
      },
    },
    {
      id: "toggle-show-minimap",
      label: settings.showMinimap ? "Editor: Hide Minimap" : "Editor: Show Minimap",
      description: settings.showMinimap
        ? "Hide the editor minimap overview"
        : "Show the editor minimap overview",
      icon: <Code2 />,
      category: "Editor",
      action: () => {
        updateSetting("showMinimap", !settings.showMinimap);
        onClose();
      },
    },
    {
      id: "toggle-telemetry",
      label: settings.telemetry ? "Advanced: Disable Telemetry" : "Advanced: Enable Telemetry",
      description: settings.telemetry
        ? "Stop sending anonymous usage diagnostics"
        : "Enable anonymous usage diagnostics",
      icon: <Info />,
      category: "Advanced",
      action: () => {
        updateSetting("telemetry", !settings.telemetry);
        onClose();
      },
    },
    {
      id: "toggle-breadcrumbs",
      label: settings.coreFeatures.breadcrumbs
        ? "Features: Disable Breadcrumbs"
        : "Features: Enable Breadcrumbs",
      description: settings.coreFeatures.breadcrumbs
        ? "Hide breadcrumbs navigation"
        : "Show breadcrumbs navigation",
      icon: <ChevronRight />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          breadcrumbs: !settings.coreFeatures.breadcrumbs,
        });
        onClose();
      },
    },
    {
      id: "toggle-diagnostics",
      label: settings.coreFeatures.diagnostics
        ? "Features: Disable Diagnostics"
        : "Features: Enable Diagnostics",
      description: settings.coreFeatures.diagnostics
        ? "Hide diagnostics panel"
        : "Show diagnostics panel",
      icon: <AlertCircle />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          diagnostics: !settings.coreFeatures.diagnostics,
        });
        onClose();
      },
    },
    {
      id: "toggle-debugger-feature",
      label: settings.coreFeatures.debugger
        ? "Features: Disable Debugger"
        : "Features: Enable Debugger",
      description: settings.coreFeatures.debugger
        ? "Disable run and debug panel"
        : "Enable run and debug panel",
      icon: <AlertCircle />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          debugger: !settings.coreFeatures.debugger,
        });
        onClose();
      },
    },
    {
      id: "toggle-search-feature",
      label: settings.coreFeatures.search ? "Features: Disable Search" : "Features: Enable Search",
      description: settings.coreFeatures.search
        ? "Disable search functionality"
        : "Enable search functionality",
      icon: <Search />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          search: !settings.coreFeatures.search,
        });
        onClose();
      },
    },
    {
      id: "toggle-git-feature",
      label: settings.coreFeatures.git ? "Features: Disable Git" : "Features: Enable Git",
      description: settings.coreFeatures.git ? "Disable Git integration" : "Enable Git integration",
      icon: <GitBranch />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          git: !settings.coreFeatures.git,
        });
        onClose();
      },
    },
    {
      id: "toggle-terminal-feature",
      label: settings.coreFeatures.terminal
        ? "Features: Disable Terminal"
        : "Features: Enable Terminal",
      description: settings.coreFeatures.terminal
        ? "Disable integrated terminal"
        : "Enable integrated terminal",
      icon: <Terminal />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          terminal: !settings.coreFeatures.terminal,
        });
        onClose();
      },
    },
    {
      id: "toggle-ai-chat-feature",
      label: settings.coreFeatures.aiChat
        ? "Features: Disable AI Chat"
        : "Features: Enable AI Chat",
      description: settings.coreFeatures.aiChat ? "Disable AI chat panel" : "Enable AI chat panel",
      icon: <MessageSquare />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          aiChat: !settings.coreFeatures.aiChat,
        });
        onClose();
      },
    },
    {
      id: "toggle-remote-feature",
      label: settings.coreFeatures.remote ? "Features: Disable Remote" : "Features: Enable Remote",
      description: settings.coreFeatures.remote
        ? "Disable remote development"
        : "Enable remote development",
      icon: <Cloud />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          remote: !settings.coreFeatures.remote,
        });
        onClose();
      },
    },
    {
      id: "toggle-commands-persistence",
      label: settings.coreFeatures.persistentCommands
        ? "Features: Disable Persistent Commands"
        : "Features: Enable Persistent Commands",
      description: settings.coreFeatures.persistentCommands
        ? "Disable persistent commands"
        : "Enable persistent commands",
      icon: <Cloud />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          persistentCommands: !settings.coreFeatures.persistentCommands,
        });
        onClose();
      },
    },
    ...openSettingsTabActions,
    ...generatedSettingActions,
  ];
};

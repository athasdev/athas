import {
  AlertCircle,
  ChevronRight,
  Cloud,
  Code2,
  GitBranch,
  Hash,
  Info,
  Languages,
  Lightbulb,
  MessageSquare,
  MousePointer2,
  Palette,
  Save,
  Search,
  Settings,
  Sparkles,
  Terminal,
  WrapText,
} from "lucide-react";
import type { Action } from "../models/action.types";

interface SettingsActionsParams {
  settings: {
    vimMode: boolean;
    wordWrap: boolean;
    lineNumbers: boolean;
    vimRelativeLineNumbers: boolean;
    autoSave: boolean;
    mouseWheelZoom: boolean;
    autoDetectLanguage: boolean;
    formatOnSave: boolean;
    autoCompletion: boolean;
    parameterHints: boolean;
    aiCompletion: boolean;
    coreFeatures: {
      breadcrumbs: boolean;
      diagnostics: boolean;
      search: boolean;
      git: boolean;
      terminal: boolean;
      aiChat: boolean;
      remote: boolean;
    };
  };
  setIsSettingsDialogVisible: (v: boolean) => void;
  setIsThemeSelectorVisible: (v: boolean) => void;
  setIsIconThemeSelectorVisible: (v: boolean) => void;
  updateSetting: (key: string, value: any) => void | Promise<void>;
  handleFileSelect: ((path: string, isDir: boolean) => void) | undefined;
  getAppDataDir: () => Promise<string>;
  onClose: () => void;
}

export const createSettingsActions = (params: SettingsActionsParams): Action[] => {
  const {
    settings,
    setIsSettingsDialogVisible,
    setIsThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
    updateSetting,
    handleFileSelect,
    getAppDataDir,
    onClose,
  } = params;

  return [
    {
      id: "open-settings",
      label: "Preferences: Open Settings",
      description: "Open settings dialog",
      icon: <Settings size={14} />,
      category: "Settings",
      keybinding: ["⌘", ","],
      action: () => {
        onClose();
        setIsSettingsDialogVisible(true);
      },
    },
    {
      id: "open-settings-json",
      label: "Preferences: Open Settings JSON file",
      description: "Open settings JSON file",
      icon: <Settings size={14} />,
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
      icon: <Palette size={14} />,
      category: "Theme",
      keybinding: ["⌘", "T"],
      action: () => {
        onClose();
        setIsThemeSelectorVisible(true);
      },
    },
    {
      id: "icon-theme",
      label: "Preferences: Icon Theme",
      description: "Choose an icon theme",
      icon: <Palette size={14} />,
      category: "Theme",
      action: () => {
        onClose();
        setIsIconThemeSelectorVisible(true);
      },
    },
    {
      id: "toggle-vim-mode",
      label: settings.vimMode ? "Vim: Disable Vim Mode" : "Vim: Enable Vim Mode",
      description: settings.vimMode ? "Switch to normal editing mode" : "Enable Vim keybindings",
      icon: <Terminal size={14} />,
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
      icon: <WrapText size={14} />,
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
      icon: <Hash size={14} />,
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
      icon: <Hash size={14} />,
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
      icon: <Save size={14} />,
      category: "Settings",
      action: () => {
        updateSetting("autoSave", !settings.autoSave);
        onClose();
      },
    },
    {
      id: "toggle-mouse-wheel-zoom",
      label: settings.mouseWheelZoom
        ? "General: Disable Mouse Wheel Zoom"
        : "General: Enable Mouse Wheel Zoom",
      description: settings.mouseWheelZoom
        ? "Disable zoom with mouse wheel"
        : "Use mouse wheel to zoom in/out",
      icon: <MousePointer2 size={14} />,
      category: "Settings",
      action: () => {
        updateSetting("mouseWheelZoom", !settings.mouseWheelZoom);
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
      icon: <Languages size={14} />,
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
      icon: <Code2 size={14} />,
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
      icon: <Lightbulb size={14} />,
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
      icon: <Info size={14} />,
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
      icon: <Sparkles size={14} />,
      category: "AI",
      action: () => {
        updateSetting("aiCompletion", !settings.aiCompletion);
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
      icon: <ChevronRight size={14} />,
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
      icon: <AlertCircle size={14} />,
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
      id: "toggle-search-feature",
      label: settings.coreFeatures.search ? "Features: Disable Search" : "Features: Enable Search",
      description: settings.coreFeatures.search
        ? "Disable search functionality"
        : "Enable search functionality",
      icon: <Search size={14} />,
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
      icon: <GitBranch size={14} />,
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
      icon: <Terminal size={14} />,
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
      icon: <MessageSquare size={14} />,
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
      icon: <Cloud size={14} />,
      category: "Features",
      action: () => {
        updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          remote: !settings.coreFeatures.remote,
        });
        onClose();
      },
    },
  ];
};

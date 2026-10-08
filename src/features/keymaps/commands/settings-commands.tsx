import type { ReactNode } from "react";
import {
  ChatBubbleTextIcon,
  ChevronRightIcon,
  CloudIcon,
  CodeIcon,
  GitBranchIcon,
  GridIcon,
  HashIcon,
  InfoIcon,
  LightbulbIcon,
  ListIcon,
  PaletteIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TerminalWindowIcon,
  TranslateIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import { pushCommandPaletteView } from "@/features/command-palette/services/command-palette-session";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import type { Settings } from "@/features/settings/types/settings.types";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import type { SettingsTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import type { Command } from "../types/keymaps.types";

export const settingsTabLabels: Record<SettingsTab, string> = {
  account: "Account",
  sharing: "Cloud",
  notifications: "Notifications",
  general: "General",
  editor: "Editor",
  git: "Git",
  appearance: "Appearance",
  ai: "AI",
  "ai-models": "AI Models & Keys",
  "ai-completion": "Tab Completion",
  "ai-agents": "AI Agents",
  "ai-mcp": "MCP Servers",
  keyboard: "Keybindings",
  language: "Editor",
  collaboration: "Collaboration",
  enterprise: "Enterprise",
  advanced: "Advanced",
  terminal: "Terminal",
  "file-explorer": "Files",
};

/** Opens a settings tab with an optional search query, matching the Settings page search. */
export async function openSettingsWithQuery(tab: SettingsTab | undefined, query: string) {
  const { useSettingsSearchStore } =
    await import("@/features/settings/stores/settings-search.store");
  useSettingsSearchStore.getState().actions.setQuery(query);
  useUIState.getState().openSettings(tab);
}

type BooleanSettingKey = {
  [Key in keyof Settings]: Settings[Key] extends boolean ? Key : never;
}[keyof Settings];

type BooleanCoreFeatureKey = {
  [Key in keyof CoreFeaturesState]: CoreFeaturesState[Key] extends boolean ? Key : never;
}[keyof CoreFeaturesState];

interface ToggleCopy {
  label: string;
  description: string;
}

interface SettingToggle {
  id: string;
  title: string;
  category: string;
  icon: ReactNode;
  enabled: ToggleCopy;
  disabled: ToggleCopy;
}

function settingToggleCommand(
  setting: BooleanSettingKey,
  { id, title, category, icon, enabled, disabled }: SettingToggle,
): Command {
  return {
    id,
    title,
    category,
    icon,
    palette: ({ settings }) => (settings[setting] ? enabled : disabled),
    execute: () => {
      const { settings, actions } = useSettingsStore.getState();
      void actions.updateSetting(setting, !settings[setting]);
    },
  };
}

function coreFeatureToggleCommand(
  feature: BooleanCoreFeatureKey,
  { id, title, category, icon, enabled, disabled }: SettingToggle,
): Command {
  return {
    id,
    title,
    category,
    icon,
    palette: ({ settings }) => (settings.coreFeatures[feature] ? enabled : disabled),
    execute: () => {
      const { settings, actions } = useSettingsStore.getState();
      void actions.updateSetting("coreFeatures", {
        ...settings.coreFeatures,
        [feature]: !settings.coreFeatures[feature],
      });
    },
  };
}

function featureToggle(
  feature: BooleanCoreFeatureKey,
  name: string,
  icon: ReactNode,
  enabledDescription: string,
  disabledDescription: string,
): Command {
  return coreFeatureToggleCommand(feature, {
    id: `features.toggle${name.split(" ").join("")}`,
    title: `Features: Toggle ${name}`,
    category: "Features",
    icon,
    enabled: { label: `Features: Disable ${name}`, description: enabledDescription },
    disabled: { label: `Features: Enable ${name}`, description: disabledDescription },
  });
}

export const settingsTabCommandIds = (Object.keys(settingsTabLabels) as SettingsTab[])
  .filter((tab) => tab !== "language")
  .map((tab) => `preferences.openSettingsTab.${tab}`);

const settingsTabCommands: Command[] = (
  Object.entries(settingsTabLabels) as Array<[SettingsTab, string]>
)
  .filter(([tab]) => tab !== "language")
  .map(([tab, label]) => ({
    id: `preferences.openSettingsTab.${tab}`,
    title: `Preferences: Open ${label} Settings`,
    category: "Settings",
    description: `Open the ${label.toLowerCase()} settings tab`,
    icon: <SettingsIcon />,
    palette: true,
    execute: () => openSettingsWithQuery(tab, ""),
  }));

export const settingsCommands: Command[] = [
  {
    id: "help.sendProductFeedback",
    title: "Help: Send Product Feedback",
    category: "Settings",
    description: "Describe your intent, what happened, and what you expected",
    icon: <ChatBubbleTextIcon />,
    palette: true,
    execute: async () => {
      const { openProductFeedback } = await import("@/features/feedback/services/product-feedback");
      openProductFeedback();
    },
  },
  {
    id: "help.openOnboarding",
    title: "Help: Open Onboarding",
    category: "Settings",
    description: "Open the onboarding flow again",
    icon: <SparkleIcon />,
    palette: true,
    execute: async () => {
      const { useOnboardingStore } = await import("@/features/onboarding/stores/onboarding.store");
      await useOnboardingStore.getState().actions.openPreview();
    },
  },
  {
    id: "preferences.openSettingsJson",
    title: "Preferences: Open Settings JSON file",
    category: "Settings",
    description: "Open settings JSON file",
    icon: <SettingsIcon />,
    palette: true,
    execute: async () => {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const path = await appDataDir();
      void useFileSystemStore.getState().handleFileSelect(`${path}/settings.json`, false);
    },
  },
  {
    id: "preferences.colorTheme",
    title: "Preferences: Color Theme",
    category: "Theme",
    description: "Choose a color theme",
    icon: <PaletteIcon />,
    palette: { keybindingCommandId: "workbench.showThemeSelector", closePalette: "never" },
    execute: () => pushCommandPaletteView("color-theme"),
  },
  {
    id: "preferences.iconTheme",
    title: "Preferences: Icons",
    category: "Theme",
    description: "Choose an icon theme",
    icon: <GridIcon />,
    palette: { closePalette: "never" },
    execute: () => pushCommandPaletteView("icon-theme"),
  },
  {
    id: "settings.toggleVimMode",
    title: "Vim Mode: Toggle",
    category: "Vim",
    icon: <TerminalWindowIcon />,
    palette: ({ settings }) => ({
      description: settings.vimMode ? "Currently enabled" : "Currently disabled",
    }),
    execute: () => {
      const { settings, actions } = useSettingsStore.getState();
      void actions.updateSetting("vimMode", !settings.vimMode);
    },
  },
  {
    id: "settings.toggleRelativeLineNumbers",
    title: "Editor: Toggle Relative Line Numbers",
    category: "Editor",
    icon: <HashIcon />,
    palette: ({ settings }) =>
      settings.vimRelativeLineNumbers
        ? {
            label: "Editor: Disable Relative Line Numbers",
            description: "Use absolute line numbers",
          }
        : {
            label: "Editor: Enable Relative Line Numbers",
            description: "Show relative line numbers (Vim mode)",
          },
    execute: () => {
      const { settings, actions } = useSettingsStore.getState();
      const nextEnabled = !settings.vimRelativeLineNumbers;
      if (nextEnabled && !settings.lineNumbers) {
        void actions.updateSetting("lineNumbers", true);
      }
      void actions.updateSetting("vimRelativeLineNumbers", nextEnabled);
    },
  },
  settingToggleCommand("autoSave", {
    id: "settings.toggleAutoSave",
    title: "General: Toggle Auto Save",
    category: "Settings",
    icon: <SaveIcon />,
    enabled: {
      label: "General: Disable Auto Save",
      description: "Disable automatic file saving",
    },
    disabled: {
      label: "General: Enable Auto Save",
      description: "Automatically save files when editing",
    },
  }),
  settingToggleCommand("autoDetectLanguage", {
    id: "settings.toggleAutoDetectLanguage",
    title: "Language: Toggle Auto-detect Language",
    category: "Language",
    icon: <TranslateIcon />,
    enabled: {
      label: "Language: Disable Auto-detect Language",
      description: "Manually set language for files",
    },
    disabled: {
      label: "Language: Enable Auto-detect Language",
      description: "Automatically detect file language from integration",
    },
  }),
  settingToggleCommand("formatOnSave", {
    id: "settings.toggleFormatOnSave",
    title: "Language: Toggle Format on Save",
    category: "Language",
    icon: <CodeIcon />,
    enabled: {
      label: "Language: Disable Format on Save",
      description: "Disable automatic formatting on save",
    },
    disabled: {
      label: "Language: Enable Format on Save",
      description: "Automatically format code when saving",
    },
  }),
  settingToggleCommand("autoCompletion", {
    id: "settings.toggleAutoCompletion",
    title: "Language: Toggle Auto Completion",
    category: "Language",
    icon: <LightbulbIcon />,
    enabled: {
      label: "Language: Disable Auto Completion",
      description: "Disable completion suggestions",
    },
    disabled: {
      label: "Language: Enable Auto Completion",
      description: "Show completion suggestions while typing",
    },
  }),
  settingToggleCommand("parameterHints", {
    id: "settings.toggleParameterHints",
    title: "Language: Toggle Parameter Hints",
    category: "Language",
    icon: <InfoIcon />,
    enabled: {
      label: "Language: Disable Parameter Hints",
      description: "Disable function parameter hints",
    },
    disabled: {
      label: "Language: Enable Parameter Hints",
      description: "Show function parameter hints",
    },
  }),
  settingToggleCommand("inlayHints", {
    id: "settings.toggleInlayHints",
    title: "Language: Toggle Inlay Hints",
    category: "Language",
    icon: <LightbulbIcon />,
    enabled: {
      label: "Language: Disable Inlay Hints",
      description: "Hide inline type and parameter hints from language servers",
    },
    disabled: {
      label: "Language: Enable Inlay Hints",
      description: "Show inline type and parameter hints from language servers",
    },
  }),
  settingToggleCommand("codeLens", {
    id: "settings.toggleCodeLens",
    title: "Language: Toggle Code Lens",
    category: "Language",
    icon: <ListIcon />,
    enabled: {
      label: "Language: Disable Code Lens",
      description: "Hide inline code actions above symbols",
    },
    disabled: {
      label: "Language: Enable Code Lens",
      description: "Show inline code actions above symbols",
    },
  }),
  settingToggleCommand("semanticTokens", {
    id: "settings.toggleSemanticTokens",
    title: "Language: Toggle Semantic Tokens",
    category: "Language",
    icon: <PaletteIcon />,
    enabled: {
      label: "Language: Disable Semantic Tokens",
      description: "Disable language server semantic highlighting",
    },
    disabled: {
      label: "Language: Enable Semantic Tokens",
      description: "Use language server semantic highlighting",
    },
  }),
  settingToggleCommand("aiCompletion", {
    id: "settings.toggleAiCompletion",
    title: "AI: Toggle AI Completion",
    category: "AI",
    icon: <SparkleIcon />,
    enabled: {
      label: "AI: Disable AI Completion",
      description: "Disable AI-powered code completion",
    },
    disabled: {
      label: "AI: Enable AI Completion",
      description: "Enable AI-powered code completion",
    },
  }),
  settingToggleCommand("telemetry", {
    id: "settings.toggleTelemetry",
    title: "Advanced: Toggle Telemetry",
    category: "Advanced",
    icon: <InfoIcon />,
    enabled: {
      label: "Advanced: Disable Telemetry",
      description: "Stop sending anonymous usage diagnostics",
    },
    disabled: {
      label: "Advanced: Enable Telemetry",
      description: "Enable anonymous usage diagnostics",
    },
  }),
  featureToggle(
    "breadcrumbs",
    "Breadcrumbs",
    <ChevronRightIcon />,
    "Hide breadcrumbs navigation",
    "Show breadcrumbs navigation",
  ),
  featureToggle(
    "diagnostics",
    "Diagnostics",
    <WarningCircleIcon />,
    "Hide diagnostics panel",
    "Show diagnostics panel",
  ),
  featureToggle(
    "debugger",
    "Debugger",
    <WarningCircleIcon />,
    "Disable run and debug panel",
    "Enable run and debug panel",
  ),
  featureToggle(
    "search",
    "Search",
    <SearchIcon />,
    "Disable search functionality",
    "Enable search functionality",
  ),
  featureToggle(
    "git",
    "Git",
    <GitBranchIcon />,
    "Disable Git integration",
    "Enable Git integration",
  ),
  featureToggle(
    "terminal",
    "Terminal",
    <TerminalWindowIcon />,
    "Disable integrated terminal",
    "Enable integrated terminal",
  ),
  featureToggle(
    "aiChat",
    "Agent Sessions",
    <ChatBubbleTextIcon />,
    "Disable agent sessions",
    "Enable agent sessions",
  ),
  featureToggle(
    "remote",
    "Remote",
    <CloudIcon />,
    "Disable remote development",
    "Enable remote development",
  ),
  featureToggle(
    "persistentCommands",
    "Persistent Commands",
    <CloudIcon />,
    "Disable persistent commands",
    "Enable persistent commands",
  ),
  ...settingsTabCommands,
];

import { normalizeUiFontSize, UI_FONT_SIZE_DEFAULT } from "@/features/settings/lib/ui-font-size";
import type { Settings } from "@/features/settings/types/settings";

export const DEFAULT_AI_PROVIDER_ID = "anthropic";
export const DEFAULT_AI_MODEL_ID = "claude-sonnet-4-6";
export const DEFAULT_AI_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";

export const defaultSettings: Settings = {
  // General
  autoSave: true,
  sidebarPosition: "left",
  quickOpenPreview: true,
  // Editor
  fontFamily: "Geist Mono Variable",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  showMinimap: false,
  // Terminal
  terminalFontFamily: "Geist Mono Variable",
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalLetterSpacing: 0,
  terminalScrollback: 10000,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalCursorWidth: 2,
  terminalDefaultShellId: "",
  terminalDefaultProfileId: "",
  // UI
  uiFontFamily: "Geist Variable",
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  // Theme
  theme: "athas-dark",
  iconTheme: "colorful-material",
  syncSystemTheme: false,
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  nativeMenuBar: false,
  compactMenuBar: true,
  titleBarProjectMode: "tabs",
  openFoldersInNewWindow: false,
  // AI
  aiProviderId: DEFAULT_AI_PROVIDER_ID,
  aiModelId: DEFAULT_AI_MODEL_ID,
  aiChatWidth: 400,
  isAIChatVisible: false,
  aiCompletion: true,
  aiAutocompleteModelId: DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  aiDefaultSessionMode: "",
  ollamaBaseUrl: "http://localhost:11434",
  // Layout
  sidebarWidth: 220,
  showGitHubPullRequests: true,
  showGitHubIssues: true,
  showGitHubActions: true,
  // Keyboard
  vimMode: false,
  vimRelativeLineNumbers: false,
  // Language
  defaultLanguage: "auto",
  autoDetectLanguage: true,
  formatOnSave: false,
  formatter: "prettier",
  lintOnSave: false,
  autoCompletion: true,
  parameterHints: true,
  // External Editor
  externalEditor: "none",
  customEditorCommand: "",
  // Features
  coreFeatures: {
    git: true,
    github: true,
    remote: true,
    terminal: true,
    search: true,
    diagnostics: true,
    aiChat: true,
    breadcrumbs: true,
    persistentCommands: true,
  },
  // Advanced
  enterpriseManagedMode: false,
  enterpriseRequireExtensionAllowlist: false,
  enterpriseAllowedExtensionIds: [],
  // Other
  extensionsActiveTab: "all",
  maxOpenTabs: 10,
  horizontalTabScroll: false,
  //// File tree
  hiddenFilePatterns: [],
  hiddenDirectoryPatterns: [],
  gitChangesFolderView: true,
  confirmBeforeDiscard: true,
  autoRefreshGitStatus: true,
  showUntrackedFiles: true,
  showStagedFirst: true,
  gitDefaultDiffView: "unified",
  openDiffOnClick: true,
  showGitStatusInFileTree: true,
  compactGitStatusBadges: false,
  collapseEmptyGitSections: false,
  rememberLastGitPanelMode: false,
  gitLastPanelMode: "changes",
  enableInlineGitBlame: true,
  enableGitGutter: true,
  // Telemetry
  telemetry: false,
};

export const getDefaultSetting = <K extends keyof Settings>(key: K): Settings[K] =>
  defaultSettings[key];

export function getDefaultSettingsSnapshot(): Settings {
  return {
    ...defaultSettings,
    coreFeatures: { ...defaultSettings.coreFeatures },
    enterpriseAllowedExtensionIds: [...defaultSettings.enterpriseAllowedExtensionIds],
    hiddenFilePatterns: [...defaultSettings.hiddenFilePatterns],
    hiddenDirectoryPatterns: [...defaultSettings.hiddenDirectoryPatterns],
    uiFontSize: normalizeUiFontSize(defaultSettings.uiFontSize),
  };
}

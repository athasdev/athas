import { normalizeUiFontSize, UI_FONT_SIZE_DEFAULT } from "@/features/settings/lib/ui-font-size";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import {
  FOOTER_LEADING_ITEM_IDS,
  FOOTER_TRAILING_ITEM_IDS,
  HEADER_TRAILING_ITEM_IDS,
  SIDEBAR_ACTIVITY_ITEM_IDS,
} from "@/features/layout/config/item-order";
import type { Settings } from "@/features/settings/types/settings";

export const DEFAULT_AI_PROVIDER_ID = "anthropic";
export const DEFAULT_AI_MODEL_ID = "claude-sonnet-4-6";
export const DEFAULT_AI_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";

export const defaultSettings: Settings = {
  // General
  autoSave: false,
  sidebarPosition: "left",
  quickOpenPreview: true,
  // Editor
  fontFamily: DEFAULT_MONO_FONT_FAMILY,
  fontSize: DEFAULT_CODE_FONT_SIZE,
  editorLineHeight: 1.4,
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  showMinimap: false,
  // Terminal
  terminalFontFamily: DEFAULT_MONO_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalLineHeight: 1,
  terminalLetterSpacing: 0,
  terminalScrollback: 10000,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalCursorWidth: 2,
  terminalDefaultShellId: "",
  terminalDefaultProfileId: "",
  // UI
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  // Theme
  theme: "athas-dark",
  iconTheme: "material",
  syncSystemTheme: false,
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  nativeMenuBar: false,
  compactMenuBar: true,
  sidebarTabsPosition: "top",
  titleBarProjectMode: "tabs",
  headerTrailingItemsOrder: [...HEADER_TRAILING_ITEM_IDS],
  sidebarActivityItemsOrder: [...SIDEBAR_ACTIVITY_ITEM_IDS],
  footerLeadingItemsOrder: [...FOOTER_LEADING_ITEM_IDS],
  footerTrailingItemsOrder: [...FOOTER_TRAILING_ITEM_IDS],
  openFoldersInNewWindow: false,
  // AI
  aiProviderId: DEFAULT_AI_PROVIDER_ID,
  aiModelId: DEFAULT_AI_MODEL_ID,
  aiChatWidth: 400,
  isAIChatVisible: false,
  aiCompletion: true,
  aiAutocompleteModelId: DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  aiDefaultSessionMode: "",
  aiSkills: [],
  ollamaBaseUrl: "http://localhost:11434",
  // Layout
  sidebarWidth: 220,
  showGitHubPullRequests: true,
  showGitHubIssues: true,
  showGitHubActions: true,
  // Keyboard
  keybindingPreset: "none",
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
    debugger: false,
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
  maxOpenTabs: 100,
  horizontalTabScroll: false,
  //// File tree
  fileTreeIndentSize: 20,
  compactFoldersInFileTree: false,
  fileTreeDensity: "default",
  showHiddenFilesInFileTree: true,
  showGitignoredFilesInFileTree: true,
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
  gitSidebarTabOrder: ["changes", "history", "worktrees"],
  githubSidebarSectionOrder: ["pull-requests", "issues", "actions"],
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
    headerTrailingItemsOrder: [...defaultSettings.headerTrailingItemsOrder],
    sidebarActivityItemsOrder: [...defaultSettings.sidebarActivityItemsOrder],
    footerLeadingItemsOrder: [...defaultSettings.footerLeadingItemsOrder],
    footerTrailingItemsOrder: [...defaultSettings.footerTrailingItemsOrder],
    aiSkills: defaultSettings.aiSkills.map((skill) => ({ ...skill })),
    uiFontSize: normalizeUiFontSize(defaultSettings.uiFontSize),
  };
}

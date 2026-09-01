import { normalizeUiFontSize, UI_FONT_SIZE_DEFAULT } from "@/features/settings/lib/ui-font-size";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import {
  GIT_SIDEBAR_TAB_IDS,
  SIDEBAR_ACTIVITY_ITEM_IDS,
} from "@/features/layout/config/item-order";
import type { Settings } from "@/features/settings/types/settings.types";

export const DEFAULT_AI_PROVIDER_ID = "anthropic";
export const DEFAULT_AI_MODEL_ID = "claude-sonnet-5";
const DEFAULT_AI_CUSTOM_BASE_URL = "";
const DEFAULT_AI_CUSTOM_MODEL_ID = "";
export const DEFAULT_AI_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";
const DEFAULT_AI_AUTOCOMPLETE_CUSTOM_BASE_URL = "";

export const defaultSettings: Settings = {
  // General
  autoSave: false,
  quickOpenPreview: true,
  // Editor
  fontFamily: DEFAULT_MONO_FONT_FAMILY,
  fontSize: DEFAULT_CODE_FONT_SIZE,
  editorLineHeight: 1.4,
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  renderWhitespace: "none",
  renderIndentGuides: true,
  highlightOccurrences: true,
  showMinimap: false,
  showOutline: false,
  editorFontLigatures: false,
  editorItalicComments: false,
  editorStickyScroll: false,
  editorBracketPairColorization: true,
  editorSmoothScrolling: false,
  editorScrollBeyondLastLine: false,
  editorCursorStyle: "line",
  editorCursorBlinking: "blink",
  inlayHints: true,
  codeLens: true,
  semanticTokens: true,
  breadcrumbShowSymbols: true,
  // Terminal
  terminalFontFamily: DEFAULT_MONO_FONT_FAMILY,
  terminalFontSize: DEFAULT_CODE_FONT_SIZE,
  terminalLineHeight: 1,
  terminalLetterSpacing: 0,
  terminalScrollback: 10000,
  terminalCursorStyle: "bar",
  terminalCursorBlink: true,
  terminalCursorWidth: 2,
  terminalCursorInactiveStyle: "outline",
  terminalAltClickMovesCursor: true,
  terminalMacOptionIsMeta: false,
  terminalRightClickSelectsWord: false,
  terminalDefaultShellId: "",
  terminalDefaultProfileId: "",
  // UI
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  reduceMotion: false,
  showTabIcons: true,
  tabCloseButtonVisibility: "active",
  // Theme
  theme: "athas-dark",
  iconTheme: "pierre-icons-complete",
  syncSystemTheme: false,
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  nativeMenuBar: false,
  compactMenuBar: true,
  windowTransparency: false,
  sidebarActivityItemsOrder: [...SIDEBAR_ACTIVITY_ITEM_IDS],
  hiddenSidebarActivityItems: [],
  openFoldersInNewWindow: true,
  // AI
  aiProviderId: DEFAULT_AI_PROVIDER_ID,
  aiModelId: DEFAULT_AI_MODEL_ID,
  aiCustomBaseUrl: DEFAULT_AI_CUSTOM_BASE_URL,
  aiCustomModelId: DEFAULT_AI_CUSTOM_MODEL_ID,
  aiCompletion: true,
  aiAutocompleteProvider: "openrouter",
  aiAutocompleteModelId: DEFAULT_AI_AUTOCOMPLETE_MODEL_ID,
  aiAutocompleteCustomBaseUrl: DEFAULT_AI_AUTOCOMPLETE_CUSTOM_BASE_URL,
  aiAutocompleteCustomModelId: "",
  aiDefaultSessionMode: "",
  aiAgentNotifications: false,
  aiSkills: [],
  v0DesignSystems: [],
  activeV0DesignSystemId: "",
  ollamaBaseUrl: "http://localhost:11434",
  // Layout
  activityRailExpanded: false,
  activityRailWidth: 180,
  showActivityRailAgentHistory: true,
  showActivityRailTerminals: true,
  showActivityRailProjectIcons: true,
  collapsedActivityRailSections: [],
  sidebarWidth: 220,
  rightSidebarWidth: 220,
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
    ghosttyTerminal: false,
    search: true,
    diagnostics: true,
    debugger: true,
    docker: true,
    aiChat: true,
    teamCollaboration: true,
    breadcrumbs: true,
    persistentCommands: true,
    webViewer: false,
  },
  // Advanced
  enterpriseManagedMode: false,
  enterpriseRequireExtensionAllowlist: false,
  enterpriseAllowedExtensionIds: [],
  // Other
  lastSettingsTab: "general",
  extensionsActiveTab: "all",
  maxOpenTabs: 100,
  horizontalTabScroll: false,
  //// File tree
  fileTreeSortOrder: "folders-first",
  fileTreeIndentSize: 16,
  compactFoldersInFileTree: false,
  hideRootFolderInFileTree: false,
  autoRevealActiveFileInFileTree: true,
  showFileIconsInFileTree: true,
  showFolderArrowsInFileTree: false,
  showIndentGuidesInFileTree: true,
  confirmBeforeFileDelete: true,
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
  gitSidebarTabOrder: [...GIT_SIDEBAR_TAB_IDS],
  hiddenGitSidebarItems: [],
  githubSidebarSectionOrder: ["pull-requests", "issues", "actions"],
  enableInlineGitBlame: true,
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
    sidebarActivityItemsOrder: [...defaultSettings.sidebarActivityItemsOrder],
    hiddenSidebarActivityItems: [...defaultSettings.hiddenSidebarActivityItems],
    hiddenGitSidebarItems: [...defaultSettings.hiddenGitSidebarItems],
    collapsedActivityRailSections: [...defaultSettings.collapsedActivityRailSections],
    aiSkills: defaultSettings.aiSkills.map((skill) => ({ ...skill })),
    v0DesignSystems: defaultSettings.v0DesignSystems.map((profile) => ({ ...profile })),
    uiFontSize: normalizeUiFontSize(defaultSettings.uiFontSize),
  };
}

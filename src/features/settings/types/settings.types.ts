import type { CoreFeaturesState } from "./feature.types";
import type { V0DesignSystemProfile } from "@/extensions/v0/types/v0-design-system.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import type {
  FooterLeadingItemId,
  FooterTrailingItemId,
  HeaderTrailingItemId,
  SidebarActivityItemId,
} from "@/features/layout/config/item-order";

export type Theme = string;
export type RenderWhitespaceMode = "none" | "boundary" | "trailing" | "all";
export type EditorEngine = "monaco" | "athas" | "nvim" | "helix" | "vim" | "custom";
export type SettingsSection =
  | "account"
  | "general"
  | "editor"
  | "git"
  | "appearance"
  | "ai"
  | "keyboard"
  | "collaboration"
  | "enterprise"
  | "advanced"
  | "terminal"
  | "file-explorer";

export interface Settings {
  // General
  autoSave: boolean;
  quickOpenPreview: boolean;
  // Editor
  fontFamily: string;
  editorEngine: EditorEngine;
  fontSize: number;
  editorLineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  renderWhitespace: RenderWhitespaceMode;
  renderIndentGuides: boolean;
  highlightOccurrences: boolean;
  showMinimap: boolean;
  inlayHints: boolean;
  codeLens: boolean;
  semanticTokens: boolean;
  // Terminal
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalLetterSpacing: number;
  terminalScrollback: number;
  terminalCursorStyle: "block" | "underline" | "bar";
  terminalCursorBlink: boolean;
  terminalCursorWidth: number;
  terminalDefaultShellId: string;
  terminalDefaultProfileId: string;
  // UI
  uiFontFamily: string;
  uiFontSize: number;
  // Theme
  theme: Theme;
  iconTheme: string;
  syncSystemTheme: boolean;
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  nativeMenuBar: boolean;
  compactMenuBar: boolean;
  windowTransparency: boolean;
  headerTrailingItemsOrder: HeaderTrailingItemId[];
  sidebarActivityItemsOrder: Array<SidebarActivityItemId | string>;
  footerLeadingItemsOrder: FooterLeadingItemId[];
  footerTrailingItemsOrder: FooterTrailingItemId[];
  openFoldersInNewWindow: boolean;
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiCustomBaseUrl: string;
  aiCustomModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  aiAutocompleteProvider: "openrouter" | "custom";
  aiAutocompleteModelId: string;
  aiAutocompleteCustomBaseUrl: string;
  aiAutocompleteCustomModelId: string;
  aiDefaultSessionMode: string;
  aiSkills: AIChatSkill[];
  v0DesignSystems: V0DesignSystemProfile[];
  activeV0DesignSystemId: string;
  ollamaBaseUrl: string;
  // Layout
  sidebarWidth: number;
  showGitHubPullRequests: boolean;
  showGitHubIssues: boolean;
  showGitHubActions: boolean;
  // Keyboard
  keybindingPreset:
    | "none"
    | "vscode"
    | "jetbrains"
    | "sublime"
    | "xcode"
    | "atom"
    | "emacs"
    | "zed";
  vimMode: boolean;
  vimRelativeLineNumbers: boolean;
  // Language
  defaultLanguage: string;
  autoDetectLanguage: boolean;
  formatOnSave: boolean;
  formatter: string;
  lintOnSave: boolean;
  autoCompletion: boolean;
  parameterHints: boolean;
  // External Editor
  externalEditor: "none" | "nvim" | "helix" | "vim" | "custom";
  customEditorCommand: string;
  // Features
  coreFeatures: CoreFeaturesState;
  // Advanced
  enterpriseManagedMode: boolean;
  enterpriseRequireExtensionAllowlist: boolean;
  enterpriseAllowedExtensionIds: string[];
  // Other
  lastSettingsTab: SettingsSection;
  extensionsActiveTab:
    | "all"
    | "core"
    | "language"
    | "theme"
    | "icon-theme"
    | "snippet"
    | "database"
    | "ai"
    | "skill"
    | "agent";
  maxOpenTabs: number;
  horizontalTabScroll: boolean;
  //// File tree
  fileTreeIndentSize: number;
  compactFoldersInFileTree: boolean;
  hideRootFolderInFileTree: boolean;
  showHiddenFilesInFileTree: boolean;
  showGitignoredFilesInFileTree: boolean;
  hiddenFilePatterns: string[];
  hiddenDirectoryPatterns: string[];
  gitChangesFolderView: boolean;
  confirmBeforeDiscard: boolean;
  autoRefreshGitStatus: boolean;
  showUntrackedFiles: boolean;
  showStagedFirst: boolean;
  gitDefaultDiffView: "unified" | "split";
  openDiffOnClick: boolean;
  showGitStatusInFileTree: boolean;
  compactGitStatusBadges: boolean;
  collapseEmptyGitSections: boolean;
  rememberLastGitPanelMode: boolean;
  gitLastPanelMode: "changes" | "history";
  gitSidebarTabOrder: Array<"changes" | "history">;
  githubSidebarSectionOrder: Array<"pull-requests" | "issues" | "actions">;
  enableInlineGitBlame: boolean;
  enableGitGutter: boolean;
  // Telemetry
  telemetry: boolean;
}

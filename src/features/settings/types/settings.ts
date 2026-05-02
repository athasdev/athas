import type { CoreFeaturesState } from "./feature";
import type { AIChatSkill } from "@/features/ai/types/skills";
import type {
  FooterLeadingItemId,
  FooterTrailingItemId,
  HeaderTrailingItemId,
  SidebarActivityItemId,
} from "@/features/layout/config/item-order";

export type Theme = string;

export interface Settings {
  // General
  autoSave: boolean;
  sidebarPosition: "left" | "right";
  quickOpenPreview: boolean;
  // Editor
  fontFamily: string;
  fontSize: number;
  editorLineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  showMinimap: boolean;
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
  sidebarTabsPosition: "top" | "left";
  titleBarProjectMode: "tabs" | "window";
  headerTrailingItemsOrder: HeaderTrailingItemId[];
  sidebarActivityItemsOrder: Array<SidebarActivityItemId | string>;
  footerLeadingItemsOrder: FooterLeadingItemId[];
  footerTrailingItemsOrder: FooterTrailingItemId[];
  openFoldersInNewWindow: boolean;
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  aiAutocompleteModelId: string;
  aiDefaultSessionMode: string;
  aiSkills: AIChatSkill[];
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
  externalEditor: "none" | "nvim" | "helix" | "vim" | "nano" | "emacs" | "custom";
  customEditorCommand: string;
  // Features
  coreFeatures: CoreFeaturesState;
  // Advanced
  enterpriseManagedMode: boolean;
  enterpriseRequireExtensionAllowlist: boolean;
  enterpriseAllowedExtensionIds: string[];
  // Other
  extensionsActiveTab:
    | "all"
    | "core"
    | "language"
    | "theme"
    | "icon-theme"
    | "snippet"
    | "database"
    | "skill"
    | "ui";
  maxOpenTabs: number;
  horizontalTabScroll: boolean;
  //// File tree
  fileTreeIndentSize: number;
  compactFoldersInFileTree: boolean;
  fileTreeDensity: "compact" | "default" | "comfortable";
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
  gitLastPanelMode: "changes" | "history" | "worktrees";
  gitSidebarTabOrder: Array<"changes" | "history" | "worktrees">;
  githubSidebarSectionOrder: Array<"pull-requests" | "issues" | "actions">;
  enableInlineGitBlame: boolean;
  enableGitGutter: boolean;
  // Telemetry
  telemetry: boolean;
}

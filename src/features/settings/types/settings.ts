import type { CoreFeaturesState } from "./feature";

export type Theme = string;

export interface Settings {
  // General
  autoSave: boolean;
  sidebarPosition: "left" | "right";
  quickOpenPreview: boolean;
  // Editor
  fontFamily: string;
  fontSize: number;
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
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  nativeMenuBar: boolean;
  compactMenuBar: boolean;
  titleBarProjectMode: "tabs" | "window";
  // AI
  aiProviderId: string;
  aiModelId: string;
  aiChatWidth: number;
  isAIChatVisible: boolean;
  aiCompletion: boolean;
  aiAutocompleteModelId: string;
  aiDefaultSessionMode: string;
  ollamaBaseUrl: string;
  // Layout
  sidebarWidth: number;
  // Keyboard
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
    | "database";
  maxOpenTabs: number;
  horizontalTabScroll: boolean;
  //// File tree
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
  gitLastPanelMode: "changes" | "stash" | "history" | "worktrees";
  enableInlineGitBlame: boolean;
  enableGitGutter: boolean;
}

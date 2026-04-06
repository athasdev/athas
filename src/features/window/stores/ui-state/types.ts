export type SettingsTab =
  | "account"
  | "general"
  | "editor"
  | "git"
  | "appearance"
  | "databases"
  | "extensions"
  | "ai"
  | "keyboard"
  | "language"
  | "features"
  | "enterprise"
  | "advanced"
  | "terminal"
  | "file-explorer";

export type BottomPaneTab = "terminal" | "diagnostics" | "references";

export interface QuickEditSelection {
  text: string;
  start: number;
  end: number;
  cursorPosition: { x: number; y: number };
}

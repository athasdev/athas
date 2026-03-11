export type SettingsTab =
  | "general"
  | "editor"
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
  | "web-viewer";

export type BottomPaneTab = "terminal" | "diagnostics";

export interface QuickEditSelection {
  text: string;
  start: number;
  end: number;
  cursorPosition: { x: number; y: number };
}

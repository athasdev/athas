export type SettingsTab =
  | "general"
  | "editor"
  | "appearance"
  | "extensions"
  | "ai"
  | "keyboard"
  | "language"
  | "features"
  | "advanced"
  | "fileTree"
  | "terminal";

export type BottomPaneTab = "terminal" | "diagnostics";

export interface QuickEditSelection {
  text: string;
  start: number;
  end: number;
  cursorPosition: { x: number; y: number };
}

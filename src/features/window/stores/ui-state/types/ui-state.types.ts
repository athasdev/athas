export type SettingsTab =
  | "sharing"
  | "account"
  | "general"
  | "notifications"
  | "editor"
  | "git"
  | "appearance"
  | "ai"
  | "ai-models"
  | "ai-completion"
  | "ai-agents"
  | "ai-mcp"
  | "keyboard"
  | "language"
  | "collaboration"
  | "enterprise"
  | "advanced"
  | "terminal"
  | "file-explorer";

export type BottomPaneTab = "terminal" | "debugger" | "diagnostics" | "references" | "buffers";

export interface QuickEditSelection {
  text: string;
  start: number;
  end: number;
  cursorPosition: { x: number; y: number };
}

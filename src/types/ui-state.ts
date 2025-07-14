export type RightPaneMode = "chat";

export type BottomPaneTab = "terminal" | "diagnostics";

export interface QuickEditSelection {
  text: string;
  start: number;
  end: number;
  cursorPosition: { x: number; y: number };
}

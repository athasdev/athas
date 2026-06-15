import type { ReactNode } from "react";

export interface Action {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  category: string;
  /** Registered command id to look up the current binding from the keymap registry. */
  commandId?: string;
  action: () => void;
}

export type ActionCategory =
  | "View"
  | "Settings"
  | "Help"
  | "File"
  | "Window"
  | "Navigation"
  | "Markdown";

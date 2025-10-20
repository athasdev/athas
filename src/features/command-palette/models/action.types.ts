import type { ReactNode } from "react";

export interface Action {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  category: string;
  keybinding?: string[];
  action: () => void;
}

export type ActionCategory = "View" | "Settings" | "File" | "Window" | "Navigation";

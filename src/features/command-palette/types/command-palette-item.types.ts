import type { ReactNode } from "react";

/** One row of the command palette, resolved from a registered command or a palette provider. */
export interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  category: string;
  /** Command whose effective keybinding is shown beside the row. */
  keybindingCommandId?: string;
  /** Runs the row; `closePalette` closes the palette at the moment the row's command expects. */
  run: (closePalette: () => void) => void | Promise<void>;
}

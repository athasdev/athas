import { create } from "zustand";
import type { ContextMenuSlice } from "./ui-state/context-menu-slice";
import { createContextMenuSlice } from "./ui-state/context-menu-slice";
import type { ModalSlice } from "./ui-state/modal-slice";
import { createModalSlice } from "./ui-state/modal-slice";
import type { PanelSlice } from "./ui-state/panel-slice";
import { createPanelSlice } from "./ui-state/panel-slice";
import type { QuickEditSlice } from "./ui-state/quick-edit-slice";
import { createQuickEditSlice } from "./ui-state/quick-edit-slice";
import type { TerminalSlice } from "./ui-state/terminal-slice";
import { createTerminalSlice } from "./ui-state/terminal-slice";
import type { SettingsTab } from "./ui-state/types";
import type { ViewSlice } from "./ui-state/view-slice";
import { createViewSlice } from "./ui-state/view-slice";

// Re-export types for convenience
export type { SettingsTab };

// Combined store type
export type UIState = ModalSlice &
  PanelSlice &
  ViewSlice &
  ContextMenuSlice &
  TerminalSlice &
  QuickEditSlice;

// Create the combined store
export const useUIState = create<UIState>()((...a) => ({
  ...createModalSlice(...a),
  ...createPanelSlice(...a),
  ...createViewSlice(...a),
  ...createContextMenuSlice(...a),
  ...createTerminalSlice(...a),
  ...createQuickEditSlice(...a),
}));

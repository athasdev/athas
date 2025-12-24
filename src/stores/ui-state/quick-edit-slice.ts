import type { StateCreator } from "zustand";
import type { QuickEditSelection } from "@/stores/ui-state/types";

export interface QuickEditState {
  isQuickEditVisible: boolean;
  quickEditSelection: QuickEditSelection;
}

// No actions defined yet - can be added when needed
// biome-ignore lint/complexity/noBannedTypes: Empty type for future actions
export type QuickEditActions = {};

export type QuickEditSlice = QuickEditState & QuickEditActions;

export const createQuickEditSlice: StateCreator<QuickEditSlice, [], [], QuickEditSlice> = () => ({
  // State
  isQuickEditVisible: false,
  quickEditSelection: {
    text: "",
    start: 0,
    end: 0,
    cursorPosition: { x: 0, y: 0 },
  },

  // Actions
  // Quick edit actions can be added here when needed
});

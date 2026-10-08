import type { StateCreator } from "zustand";

interface TerminalState {
  terminalFocusCallback: (() => void) | null;
}

interface TerminalActions {
  registerTerminalFocus: (callback: () => void) => void;
  requestTerminalFocus: () => void;
  clearTerminalFocus: () => void;
}

export type TerminalSlice = TerminalState & TerminalActions;

/**
 * Whether the bottom pane is open on its terminal tab. Visibility is stored once, as the bottom
 * pane's own state; this is the one place that reads it as "the terminal is showing".
 */
export const selectIsTerminalPaneVisible = (state: {
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: string;
}) => state.isBottomPaneVisible && state.bottomPaneActiveTab === "terminal";

export const createTerminalSlice: StateCreator<TerminalSlice, [], [], TerminalSlice> = (
  set,
  get,
) => ({
  // State
  terminalFocusCallback: null,

  // Actions
  registerTerminalFocus: (callback: () => void) => set({ terminalFocusCallback: callback }),
  requestTerminalFocus: () => {
    const state = get();
    if (state.terminalFocusCallback) {
      state.terminalFocusCallback();
    }
  },
  clearTerminalFocus: () => set({ terminalFocusCallback: null }),
});

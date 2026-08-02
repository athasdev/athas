import type { StateCreator } from "zustand";

interface TerminalState {
  terminalFocusRequested: boolean;
  terminalFocusCallback: (() => void) | null;
}

interface TerminalActions {
  registerTerminalFocus: (callback: () => void) => void;
  requestTerminalFocus: () => void;
  clearTerminalFocus: () => void;
}

export type TerminalSlice = TerminalState & TerminalActions;

export const createTerminalSlice: StateCreator<TerminalSlice, [], [], TerminalSlice> = (
  set,
  get,
) => ({
  // State
  terminalFocusRequested: false,
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

import type { StateCreator } from "zustand";
import type { SettingsTab } from "./types";

export interface ModalState {
  isCommandBarVisible: boolean;
  isCommandPaletteVisible: boolean;
  isSettingsDialogVisible: boolean;
  isThemeSelectorVisible: boolean;
  isIconThemeSelectorVisible: boolean;
  isBranchManagerVisible: boolean;
  settingsInitialTab: SettingsTab;
}

export interface ModalActions {
  setIsCommandBarVisible: (v: boolean) => void;
  setIsCommandPaletteVisible: (v: boolean) => void;
  setIsSettingsDialogVisible: (v: boolean) => void;
  setIsThemeSelectorVisible: (v: boolean) => void;
  setIsIconThemeSelectorVisible: (v: boolean) => void;
  setIsBranchManagerVisible: (v: boolean) => void;
  setSettingsInitialTab: (tab: SettingsTab) => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  hasOpenModal: () => boolean;
  closeTopModal: () => boolean;
}

export type ModalSlice = ModalState & ModalActions;

export const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (set, get) => ({
  // State
  isCommandBarVisible: false,
  isCommandPaletteVisible: false,
  isSettingsDialogVisible: false,
  isThemeSelectorVisible: false,
  isIconThemeSelectorVisible: false,
  isBranchManagerVisible: false,
  settingsInitialTab: "general",

  // Actions
  hasOpenModal: () => {
    const state = get();
    return (
      state.isCommandBarVisible ||
      state.isCommandPaletteVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isSettingsDialogVisible ||
      state.isBranchManagerVisible
    );
  },

  closeTopModal: () => {
    const state = get();
    // Priority order: most recently opened first
    if (state.isThemeSelectorVisible) {
      set({ isThemeSelectorVisible: false });
      return true;
    }
    if (state.isIconThemeSelectorVisible) {
      set({ isIconThemeSelectorVisible: false });
      return true;
    }
    if (state.isCommandPaletteVisible) {
      set({ isCommandPaletteVisible: false });
      return true;
    }
    if (state.isCommandBarVisible) {
      set({ isCommandBarVisible: false });
      return true;
    }
    if (state.isSettingsDialogVisible) {
      set({ isSettingsDialogVisible: false });
      return true;
    }
    if (state.isBranchManagerVisible) {
      set({ isBranchManagerVisible: false });
      return true;
    }
    return false;
  },

  setIsCommandBarVisible: (v: boolean) => {
    if (v) {
      set({
        isCommandBarVisible: true,
        isCommandPaletteVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
      });
    } else {
      set({ isCommandBarVisible: v });
    }
  },

  setIsCommandPaletteVisible: (v: boolean) => {
    if (v) {
      set({
        isCommandPaletteVisible: true,
        isCommandBarVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
      });
    } else {
      set({ isCommandPaletteVisible: v });
    }
  },

  setIsSettingsDialogVisible: (v: boolean) => {
    if (v) {
      set({
        isSettingsDialogVisible: true,
        isCommandBarVisible: false,
        isCommandPaletteVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isBranchManagerVisible: false,
      });
    } else {
      set({ isSettingsDialogVisible: v });
    }
  },

  setIsThemeSelectorVisible: (v: boolean) => {
    if (v) {
      set({
        isThemeSelectorVisible: true,
        isCommandBarVisible: false,
        isCommandPaletteVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
      });
    } else {
      set({ isThemeSelectorVisible: v });
    }
  },

  setIsIconThemeSelectorVisible: (v: boolean) => {
    if (v) {
      set({
        isIconThemeSelectorVisible: true,
        isCommandBarVisible: false,
        isCommandPaletteVisible: false,
        isThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
      });
    } else {
      set({ isIconThemeSelectorVisible: v });
    }
  },

  setIsBranchManagerVisible: (v: boolean) => {
    if (v) {
      set({
        isBranchManagerVisible: true,
        isCommandBarVisible: false,
        isCommandPaletteVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
      });
    } else {
      set({ isBranchManagerVisible: v });
    }
  },

  setSettingsInitialTab: (tab: SettingsTab) => set({ settingsInitialTab: tab }),

  openSettingsDialog: (tab?: SettingsTab) =>
    set({
      isSettingsDialogVisible: true,
      isCommandBarVisible: false,
      isCommandPaletteVisible: false,
      isThemeSelectorVisible: false,
      isIconThemeSelectorVisible: false,
      isBranchManagerVisible: false,
      settingsInitialTab: tab || "general",
    }),
});

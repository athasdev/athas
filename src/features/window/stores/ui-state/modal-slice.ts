import type { StateCreator } from "zustand";
import type { SettingsTab } from "./types";

export interface ModalState {
  isQuickOpenVisible: boolean;
  isCommandPaletteVisible: boolean;
  isGlobalSearchVisible: boolean;
  isSettingsDialogVisible: boolean;
  isThemeSelectorVisible: boolean;
  isIconThemeSelectorVisible: boolean;
  isBranchManagerVisible: boolean;
  isProjectPickerVisible: boolean;
  isDatabaseConnectionVisible: boolean;
  settingsInitialTab: SettingsTab;
}

export interface ModalActions {
  setIsQuickOpenVisible: (v: boolean) => void;
  setIsCommandPaletteVisible: (v: boolean) => void;
  setIsGlobalSearchVisible: (v: boolean) => void;
  setIsSettingsDialogVisible: (v: boolean) => void;
  setIsThemeSelectorVisible: (v: boolean) => void;
  setIsIconThemeSelectorVisible: (v: boolean) => void;
  setIsBranchManagerVisible: (v: boolean) => void;
  setIsProjectPickerVisible: (v: boolean) => void;
  setIsDatabaseConnectionVisible: (v: boolean) => void;
  setSettingsInitialTab: (tab: SettingsTab) => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  hasOpenModal: () => boolean;
  closeTopModal: () => boolean;
}

export type ModalSlice = ModalState & ModalActions;

export const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (set, get) => ({
  // State
  isQuickOpenVisible: false,
  isCommandPaletteVisible: false,
  isGlobalSearchVisible: false,
  isSettingsDialogVisible: false,
  isThemeSelectorVisible: false,
  isIconThemeSelectorVisible: false,
  isBranchManagerVisible: false,
  isProjectPickerVisible: false,
  isDatabaseConnectionVisible: false,
  settingsInitialTab: "general",

  // Actions
  hasOpenModal: () => {
    const state = get();
    return (
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isSettingsDialogVisible ||
      state.isBranchManagerVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible
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
    if (state.isGlobalSearchVisible) {
      set({ isGlobalSearchVisible: false });
      return true;
    }
    if (state.isQuickOpenVisible) {
      set({ isQuickOpenVisible: false });
      return true;
    }
    if (state.isProjectPickerVisible) {
      set({ isProjectPickerVisible: false });
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
    if (state.isDatabaseConnectionVisible) {
      set({ isDatabaseConnectionVisible: false });
      return true;
    }
    return false;
  },

  setIsQuickOpenVisible: (v: boolean) => {
    if (v) {
      set({
        isQuickOpenVisible: true,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isQuickOpenVisible: v });
    }
  },

  setIsCommandPaletteVisible: (v: boolean) => {
    if (v) {
      set({
        isCommandPaletteVisible: true,
        isQuickOpenVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isCommandPaletteVisible: v });
    }
  },

  setIsGlobalSearchVisible: (v: boolean) => {
    if (v) {
      set({
        isGlobalSearchVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isGlobalSearchVisible: v });
    }
  },

  setIsSettingsDialogVisible: (v: boolean) => {
    if (v) {
      set({
        isSettingsDialogVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isSettingsDialogVisible: v });
    }
  },

  setIsThemeSelectorVisible: (v: boolean) => {
    if (v) {
      set({
        isThemeSelectorVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isThemeSelectorVisible: v });
    }
  },

  setIsIconThemeSelectorVisible: (v: boolean) => {
    if (v) {
      set({
        isIconThemeSelectorVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isIconThemeSelectorVisible: v });
    }
  },

  setIsBranchManagerVisible: (v: boolean) => {
    if (v) {
      set({
        isBranchManagerVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isBranchManagerVisible: v });
    }
  },

  setIsProjectPickerVisible: (v: boolean) => {
    if (v) {
      set({
        isProjectPickerVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isProjectPickerVisible: v });
    }
  },

  setIsDatabaseConnectionVisible: (v: boolean) => {
    if (v) {
      set({
        isDatabaseConnectionVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isThemeSelectorVisible: false,
        isIconThemeSelectorVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
      });
    } else {
      set({ isDatabaseConnectionVisible: v });
    }
  },

  setSettingsInitialTab: (tab: SettingsTab) => set({ settingsInitialTab: tab }),

  openSettingsDialog: (tab?: SettingsTab) =>
    set((state) => ({
      isSettingsDialogVisible: true,
      isQuickOpenVisible: false,
      isCommandPaletteVisible: false,
      isGlobalSearchVisible: false,
      isThemeSelectorVisible: false,
      isIconThemeSelectorVisible: false,
      isBranchManagerVisible: false,
      isProjectPickerVisible: false,
      isDatabaseConnectionVisible: false,
      settingsInitialTab: tab || state.settingsInitialTab,
    })),
});

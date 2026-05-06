import type { StateCreator } from "zustand";
import type { CommandPaletteViewId } from "@/features/command-palette/models/view.types";
import type { SettingsTab } from "./types";

export interface ModalState {
  isQuickOpenVisible: boolean;
  isCommandPaletteVisible: boolean;
  commandPaletteInitialView: CommandPaletteViewId;
  isAgentLauncherVisible: boolean;
  isGlobalSearchVisible: boolean;
  isSettingsDialogVisible: boolean;
  isBranchManagerVisible: boolean;
  isProjectPickerVisible: boolean;
  isDatabaseConnectionVisible: boolean;
  settingsInitialTab: SettingsTab;
}

export interface ModalActions {
  setIsQuickOpenVisible: (v: boolean) => void;
  setIsCommandPaletteVisible: (v: boolean) => void;
  openCommandPaletteView: (view: CommandPaletteViewId) => void;
  setIsAgentLauncherVisible: (v: boolean) => void;
  setIsGlobalSearchVisible: (v: boolean) => void;
  setIsSettingsDialogVisible: (v: boolean) => void;
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
  commandPaletteInitialView: "root",
  isAgentLauncherVisible: false,
  isGlobalSearchVisible: false,
  isSettingsDialogVisible: false,
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
      state.isAgentLauncherVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isBranchManagerVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible
    );
  },

  closeTopModal: () => {
    const state = get();
    // Priority order: most recently opened first
    if (state.isCommandPaletteVisible) {
      set({ isCommandPaletteVisible: false });
      return true;
    }
    if (state.isAgentLauncherVisible) {
      set({ isAgentLauncherVisible: false });
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
        isAgentLauncherVisible: false,
        isGlobalSearchVisible: false,
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
        commandPaletteInitialView: "root",
        isQuickOpenVisible: false,
        isAgentLauncherVisible: false,
        isGlobalSearchVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isCommandPaletteVisible: v });
    }
  },

  openCommandPaletteView: (view: CommandPaletteViewId) => {
    set({
      isCommandPaletteVisible: true,
      commandPaletteInitialView: view,
      isQuickOpenVisible: false,
      isAgentLauncherVisible: false,
      isGlobalSearchVisible: false,
      isSettingsDialogVisible: false,
      isBranchManagerVisible: false,
      isProjectPickerVisible: false,
      isDatabaseConnectionVisible: false,
    });
  },

  setIsAgentLauncherVisible: (v: boolean) => {
    if (v) {
      set({
        isAgentLauncherVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isSettingsDialogVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isAgentLauncherVisible: v });
    }
  },

  setIsGlobalSearchVisible: (v: boolean) => {
    if (v) {
      set({
        isGlobalSearchVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isAgentLauncherVisible: false,
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
        isAgentLauncherVisible: false,
        isGlobalSearchVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isSettingsDialogVisible: v });
    }
  },

  setIsBranchManagerVisible: (v: boolean) => {
    if (v) {
      set({
        isBranchManagerVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isAgentLauncherVisible: false,
        isGlobalSearchVisible: false,
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
      isBranchManagerVisible: false,
      isProjectPickerVisible: false,
      isDatabaseConnectionVisible: false,
      settingsInitialTab: tab || state.settingsInitialTab,
    })),
});

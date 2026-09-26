import type { StateCreator } from "zustand";
import type { CommandPaletteViewId } from "@/features/command-palette/types/view.types";
import type { SettingsTab } from "./types/ui-state.types";

export type ProjectPickerInitialStep = "picker" | "addRemote";

interface ModalState {
  isQuickOpenVisible: boolean;
  isCommandPaletteVisible: boolean;
  commandPaletteInitialView: CommandPaletteViewId;
  isGlobalSearchVisible: boolean;
  isBranchManagerVisible: boolean;
  isProjectPickerVisible: boolean;
  projectPickerInitialStep: ProjectPickerInitialStep;
  isDatabaseConnectionVisible: boolean;
  settingsInitialTab: SettingsTab | null;
  settingsInitialSection: string | null;
  settingsNavigationRequestId: number;
  /** Settings is the active tab, so its navigation replaces the primary sidebar's view. */
  isSettingsPageActive: boolean;
}

interface ModalActions {
  setIsQuickOpenVisible: (v: boolean) => void;
  setIsCommandPaletteVisible: (v: boolean) => void;
  openCommandPaletteView: (view: CommandPaletteViewId) => void;
  setIsGlobalSearchVisible: (v: boolean) => void;
  setIsBranchManagerVisible: (v: boolean) => void;
  setIsProjectPickerVisible: (v: boolean) => void;
  openProjectPicker: (initialStep?: ProjectPickerInitialStep) => void;
  setIsDatabaseConnectionVisible: (v: boolean) => void;
  setSettingsInitialTab: (tab: SettingsTab) => void;
  setSettingsInitialSection: (section: string | null) => void;
  /** Opens the Settings page in the main view, on `tab` and scrolled to `section` when given. */
  openSettings: (tab?: SettingsTab, section?: string) => void;
  /** Closes the Settings page. */
  closeSettings: () => void;
  setIsSettingsPageActive: (active: boolean) => void;
  hasOpenModal: () => boolean;
  closeTopModal: () => boolean;
}

export type ModalSlice = ModalState & ModalActions;

export const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (set, get) => ({
  // State
  isQuickOpenVisible: false,
  isCommandPaletteVisible: false,
  commandPaletteInitialView: "root",
  isGlobalSearchVisible: false,
  isBranchManagerVisible: false,
  isProjectPickerVisible: false,
  projectPickerInitialStep: "picker",
  isDatabaseConnectionVisible: false,
  settingsInitialTab: null,
  settingsInitialSection: null,
  settingsNavigationRequestId: 0,
  isSettingsPageActive: false,

  // Actions
  hasOpenModal: () => {
    const state = get();
    return (
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
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
        isGlobalSearchVisible: false,
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
      isGlobalSearchVisible: false,
      isBranchManagerVisible: false,
      isProjectPickerVisible: false,
      isDatabaseConnectionVisible: false,
    });
  },

  setIsGlobalSearchVisible: (v: boolean) => {
    if (v) {
      set({
        isGlobalSearchVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isGlobalSearchVisible: v });
    }
  },

  setIsBranchManagerVisible: (v: boolean) => {
    if (v) {
      set({
        isBranchManagerVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isProjectPickerVisible: false,
        isDatabaseConnectionVisible: false,
      });
    } else {
      set({ isBranchManagerVisible: v });
    }
  },

  setIsProjectPickerVisible: (v: boolean) => {
    if (v) {
      get().openProjectPicker();
    } else {
      set({ isProjectPickerVisible: v });
    }
  },

  openProjectPicker: (initialStep = "picker") => {
    set({
      isProjectPickerVisible: true,
      projectPickerInitialStep: initialStep,
      isQuickOpenVisible: false,
      isCommandPaletteVisible: false,
      isGlobalSearchVisible: false,
      isBranchManagerVisible: false,
      isDatabaseConnectionVisible: false,
    });
  },

  setIsDatabaseConnectionVisible: (v: boolean) => {
    if (v) {
      set({
        isDatabaseConnectionVisible: true,
        isQuickOpenVisible: false,
        isCommandPaletteVisible: false,
        isGlobalSearchVisible: false,
        isBranchManagerVisible: false,
        isProjectPickerVisible: false,
      });
    } else {
      set({ isDatabaseConnectionVisible: v });
    }
  },

  setSettingsInitialTab: (tab: SettingsTab) =>
    set((state) => ({
      settingsInitialTab: tab,
      settingsInitialSection: null,
      settingsNavigationRequestId: state.settingsNavigationRequestId + 1,
    })),
  setSettingsInitialSection: (section: string | null) =>
    set((state) => ({
      settingsInitialSection: section,
      settingsNavigationRequestId: state.settingsNavigationRequestId + 1,
    })),

  openSettings: (tab?: SettingsTab, section?: string) => {
    set({
      isQuickOpenVisible: false,
      isCommandPaletteVisible: false,
      isGlobalSearchVisible: false,
      isBranchManagerVisible: false,
      isProjectPickerVisible: false,
      isDatabaseConnectionVisible: false,
      settingsInitialTab: tab ?? null,
      settingsInitialSection: section ?? null,
      settingsNavigationRequestId: get().settingsNavigationRequestId + 1,
    });
    // Settings is a tab in the main view with its navigation in the sidebar. The buffer store
    // loads lazily because it depends on this store.
    (
      get() as ModalSlice & { setIsSidebarVisible?: (visible: boolean) => void }
    ).setIsSidebarVisible?.(true);
    void import("@/features/editor/stores/buffer.store").then(({ useBufferStore }) => {
      useBufferStore.getState().actions.openSettingsBuffer();
    });
  },

  setIsSettingsPageActive: (active: boolean) => {
    if (get().isSettingsPageActive !== active) set({ isSettingsPageActive: active });
  },

  closeSettings: () => {
    void import("@/features/editor/stores/buffer.store").then(({ useBufferStore }) => {
      const { buffers, actions } = useBufferStore.getState();
      const settings = buffers.find((buffer) => buffer.type === "settings");
      if (settings) actions.closeBuffer(settings.id);
    });
  },
});

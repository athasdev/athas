import { create } from "zustand";
import { combine } from "zustand/middleware";
import type { BottomPaneTab, QuickEditSelection } from "../types/ui-state";

export type SettingsTab =
  | "general"
  | "editor"
  | "theme"
  | "ai"
  | "keyboard"
  | "language"
  | "features"
  | "advanced"
  | "fileTree";

const initialState = {
  // UI State
  isSidebarVisible: true,
  isCommandBarVisible: false,
  isCommandPaletteVisible: false,
  isFindVisible: false,

  // View States
  isGitViewActive: false,
  isSearchViewActive: false,
  isRemoteViewActive: false,
  isExtensionsViewActive: false,
  isGitHubCopilotSettingsVisible: false,

  // Dialog States
  isSettingsDialogVisible: false,
  isThemeSelectorVisible: false,
  isIconThemeSelectorVisible: false,
  isBranchManagerVisible: false,
  settingsInitialTab: "general" as SettingsTab,

  // Bottom Pane
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal" as BottomPaneTab,

  // Quick Edit
  isQuickEditVisible: false,
  quickEditSelection: {
    text: "",
    start: 0,
    end: 0,
    cursorPosition: { x: 0, y: 0 },
  } as QuickEditSelection,

  // Context Menus
  folderHeaderContextMenu: null as { x: number; y: number } | null,
  projectNameMenu: null as { x: number; y: number } | null,
  sqliteTableMenu: null as { x: number; y: number; tableName: string } | null,
  sqliteRowMenu: null as {
    x: number;
    y: number;
    rowData: Record<string, any>;
    tableName: string;
  } | null,

  // Terminal Focus Management
  terminalFocusRequested: false,
  terminalFocusCallback: null as (() => void) | null,
};

export const useUIState = create(
  combine(initialState, (set, get) => ({
    // Helper to check if any modal/overlay is open
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

    // Close all modals/overlays (for escape key handling)
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

    setIsSidebarVisible: (v: boolean) => set({ isSidebarVisible: v }),
    setIsCommandBarVisible: (v: boolean) => {
      // Close other modals when opening command bar
      if (v) {
        set({
          isCommandBarVisible: true,
          isCommandPaletteVisible: false,
          isThemeSelectorVisible: false,
          isIconThemeSelectorVisible: false,
        });
      } else {
        set({ isCommandBarVisible: v });
      }
    },
    setIsCommandPaletteVisible: (v: boolean) => {
      // Close other modals when opening command palette
      if (v) {
        set({
          isCommandPaletteVisible: true,
          isCommandBarVisible: false,
          isThemeSelectorVisible: false,
          isIconThemeSelectorVisible: false,
        });
      } else {
        set({ isCommandPaletteVisible: v });
      }
    },
    setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),

    setIsSearchViewActive: (v: boolean) => set({ isSearchViewActive: v }),
    setIsGitHubCopilotSettingsVisible: (v: boolean) => set({ isGitHubCopilotSettingsVisible: v }),

    // Dialog State actions
    setIsSettingsDialogVisible: (v: boolean) => {
      // Close other modals when opening settings
      if (v) {
        set({
          isSettingsDialogVisible: true,
          isCommandBarVisible: false,
          isCommandPaletteVisible: false,
          isThemeSelectorVisible: false,
          isIconThemeSelectorVisible: false,
        });
      } else {
        set({ isSettingsDialogVisible: v });
      }
    },
    setIsThemeSelectorVisible: (v: boolean) => {
      // Close other modals when opening theme selector
      if (v) {
        set({
          isThemeSelectorVisible: true,
          isCommandBarVisible: false,
          isCommandPaletteVisible: false,
          isIconThemeSelectorVisible: false,
        });
      } else {
        set({ isThemeSelectorVisible: v });
      }
    },
    setIsIconThemeSelectorVisible: (v: boolean) => {
      // Close other modals when opening icon theme selector
      if (v) {
        set({
          isIconThemeSelectorVisible: true,
          isCommandBarVisible: false,
          isCommandPaletteVisible: false,
          isThemeSelectorVisible: false,
        });
      } else {
        set({ isIconThemeSelectorVisible: v });
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
        settingsInitialTab: tab || "general",
      }),
    setIsBranchManagerVisible: (v: boolean) => {
      // Close other modals when opening branch manager
      if (v) {
        set({
          isBranchManagerVisible: true,
          isCommandBarVisible: false,
          isCommandPaletteVisible: false,
          isThemeSelectorVisible: false,
          isIconThemeSelectorVisible: false,
        });
      } else {
        set({ isBranchManagerVisible: v });
      }
    },

    // Bottom Pane actions
    setIsBottomPaneVisible: (v: boolean) => set({ isBottomPaneVisible: v }),
    setBottomPaneActiveTab: (tab: BottomPaneTab) => set({ bottomPaneActiveTab: tab }),

    setProjectNameMenu: (v: { x: number; y: number } | null) => set({ projectNameMenu: v }),
    setSqliteTableMenu: (v: { x: number; y: number; tableName: string } | null) =>
      set({ sqliteTableMenu: v }),
    setSqliteRowMenu: (
      v: { x: number; y: number; rowData: Record<string, any>; tableName: string } | null,
    ) => set({ sqliteRowMenu: v }),

    setActiveView: (view: "files" | "git" | "search" | "remote" | "extensions") => {
      set({
        isGitViewActive: view === "git",
        isSearchViewActive: view === "search",
        isRemoteViewActive: view === "remote",
        isExtensionsViewActive: view === "extensions",
      });
    },

    // Terminal Focus Management
    registerTerminalFocus: (callback: () => void) => set({ terminalFocusCallback: callback }),
    requestTerminalFocus: () => {
      const state = get();
      if (state.terminalFocusCallback) {
        state.terminalFocusCallback();
      }
    },
    clearTerminalFocus: () => set({ terminalFocusCallback: null }),
  })),
);

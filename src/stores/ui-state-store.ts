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
    setIsSidebarVisible: (v: boolean) => set({ isSidebarVisible: v }),
    setIsCommandBarVisible: (v: boolean) => set({ isCommandBarVisible: v }),
    setIsCommandPaletteVisible: (v: boolean) => set({ isCommandPaletteVisible: v }),
    setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),

    setIsSearchViewActive: (v: boolean) => set({ isSearchViewActive: v }),
    setIsGitHubCopilotSettingsVisible: (v: boolean) => set({ isGitHubCopilotSettingsVisible: v }),

    // Dialog State actions
    setIsSettingsDialogVisible: (v: boolean) => set({ isSettingsDialogVisible: v }),
    setIsThemeSelectorVisible: (v: boolean) => set({ isThemeSelectorVisible: v }),
    setIsIconThemeSelectorVisible: (v: boolean) => set({ isIconThemeSelectorVisible: v }),
    setSettingsInitialTab: (tab: SettingsTab) => set({ settingsInitialTab: tab }),
    openSettingsDialog: (tab?: SettingsTab) =>
      set({
        isSettingsDialogVisible: true,
        settingsInitialTab: tab || "general",
      }),

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

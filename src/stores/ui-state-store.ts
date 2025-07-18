import { create, type ExtractState } from "zustand";
import { combine } from "zustand/middleware";
import type { BottomPaneTab, QuickEditSelection } from "../types/ui-state";

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
  isGitHubCopilotSettingsVisible: false,

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
};

export const useUIState = create(
  combine(initialState, (set, _get) => ({
    // UI State actions
    setIsSidebarVisible: (v: boolean) => set({ isSidebarVisible: v }),
    setIsCommandBarVisible: (v: boolean) => set({ isCommandBarVisible: v }),
    setIsCommandPaletteVisible: (v: boolean) => set({ isCommandPaletteVisible: v }),
    setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),

    // View State actions
    setIsGitViewActive: (v: boolean) => set({ isGitViewActive: v }),
    setIsSearchViewActive: (v: boolean) => set({ isSearchViewActive: v }),
    setIsRemoteViewActive: (v: boolean) => set({ isRemoteViewActive: v }),
    setIsGitHubCopilotSettingsVisible: (v: boolean) => set({ isGitHubCopilotSettingsVisible: v }),

    // Bottom Pane actions
    setIsBottomPaneVisible: (v: boolean) => set({ isBottomPaneVisible: v }),
    setBottomPaneActiveTab: (tab: BottomPaneTab) => set({ bottomPaneActiveTab: tab }),

    // Quick Edit actions
    setIsQuickEditVisible: (v: boolean) => set({ isQuickEditVisible: v }),
    setQuickEditSelection: (sel: QuickEditSelection) => set({ quickEditSelection: sel }),

    // Context Menu actions
    setFolderHeaderContextMenu: (v: { x: number; y: number } | null) =>
      set({ folderHeaderContextMenu: v }),
    setProjectNameMenu: (v: { x: number; y: number } | null) => set({ projectNameMenu: v }),

    // Helper functions
    toggleSidebar: () => set(s => ({ isSidebarVisible: !s.isSidebarVisible })),
    toggleCommandBar: () => set(s => ({ isCommandBarVisible: !s.isCommandBarVisible })),
    toggleCommandPalette: () => set(s => ({ isCommandPaletteVisible: !s.isCommandPaletteVisible })),
    showBottomPane: (tab: BottomPaneTab) =>
      set(s => ({
        bottomPaneActiveTab: tab,
        isBottomPaneVisible: !s.isBottomPaneVisible || s.bottomPaneActiveTab !== tab,
      })),
    closeAllModals: () =>
      set({
        isCommandBarVisible: false,
        isCommandPaletteVisible: false,
        isGitHubCopilotSettingsVisible: false,
        isQuickEditVisible: false,
        isFindVisible: false,
        folderHeaderContextMenu: null,
        projectNameMenu: null,
      }),
    setActiveView: (view: "files" | "git" | "search" | "remote") => {
      set({
        isGitViewActive: view === "git",
        isSearchViewActive: view === "search",
        isRemoteViewActive: view === "remote",
      });
    },
  })),
);

export type UIState = ExtractState<typeof useUIState>;

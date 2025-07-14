import { create } from "zustand";
import type { BottomPaneTab, QuickEditSelection } from "../types/ui-state";

interface UIState {
  // UI State
  isSidebarVisible: boolean;
  setIsSidebarVisible: (v: boolean) => void;
  isRightPaneVisible: boolean;
  setIsRightPaneVisible: (v: boolean) => void;
  isCommandBarVisible: boolean;
  setIsCommandBarVisible: (v: boolean) => void;
  isCommandPaletteVisible: boolean;
  setIsCommandPaletteVisible: (v: boolean) => void;

  // View States
  isGitViewActive: boolean;
  setIsGitViewActive: (v: boolean) => void;
  isSearchViewActive: boolean;
  setIsSearchViewActive: (v: boolean) => void;
  isRemoteViewActive: boolean;
  setIsRemoteViewActive: (v: boolean) => void;
  isGitHubCopilotSettingsVisible: boolean;
  setIsGitHubCopilotSettingsVisible: (v: boolean) => void;

  // Bottom Pane
  isBottomPaneVisible: boolean;
  setIsBottomPaneVisible: (v: boolean) => void;
  bottomPaneActiveTab: BottomPaneTab;
  setBottomPaneActiveTab: (tab: BottomPaneTab) => void;

  // Quick Edit
  isQuickEditVisible: boolean;
  setIsQuickEditVisible: (v: boolean) => void;
  quickEditSelection: QuickEditSelection;
  setQuickEditSelection: (sel: QuickEditSelection) => void;

  // Context Menus
  folderHeaderContextMenu: { x: number; y: number } | null;
  setFolderHeaderContextMenu: (v: { x: number; y: number } | null) => void;
  projectNameMenu: { x: number; y: number } | null;
  setProjectNameMenu: (v: { x: number; y: number } | null) => void;

  // Helper functions
  toggleSidebar: () => void;
  toggleRightPane: () => void;
  toggleCommandBar: () => void;
  toggleCommandPalette: () => void;
  showBottomPane: (tab: BottomPaneTab) => void;
  closeAllModals: () => void;
  setActiveView: (view: "files" | "git" | "search" | "remote") => void;
}

export const useUIState = create<UIState>((set, _get) => ({
  // UI State
  isSidebarVisible: true,
  setIsSidebarVisible: v => set({ isSidebarVisible: v }),
  isRightPaneVisible: false,
  setIsRightPaneVisible: v => set({ isRightPaneVisible: v }),
  isCommandBarVisible: false,
  setIsCommandBarVisible: v => set({ isCommandBarVisible: v }),
  isCommandPaletteVisible: false,
  setIsCommandPaletteVisible: v => set({ isCommandPaletteVisible: v }),

  // View States
  isGitViewActive: false,
  setIsGitViewActive: v => set({ isGitViewActive: v }),
  isSearchViewActive: false,
  setIsSearchViewActive: v => set({ isSearchViewActive: v }),
  isRemoteViewActive: false,
  setIsRemoteViewActive: v => set({ isRemoteViewActive: v }),
  isGitHubCopilotSettingsVisible: false,
  setIsGitHubCopilotSettingsVisible: v => set({ isGitHubCopilotSettingsVisible: v }),

  // Bottom Pane
  isBottomPaneVisible: false,
  setIsBottomPaneVisible: v => set({ isBottomPaneVisible: v }),
  bottomPaneActiveTab: "terminal",
  setBottomPaneActiveTab: tab => set({ bottomPaneActiveTab: tab }),

  // Quick Edit
  isQuickEditVisible: false,
  setIsQuickEditVisible: v => set({ isQuickEditVisible: v }),
  quickEditSelection: {
    text: "",
    start: 0,
    end: 0,
    cursorPosition: { x: 0, y: 0 },
  },
  setQuickEditSelection: sel => set({ quickEditSelection: sel }),

  // Context Menus
  folderHeaderContextMenu: null,
  setFolderHeaderContextMenu: v => set({ folderHeaderContextMenu: v }),
  projectNameMenu: null,
  setProjectNameMenu: v => set({ projectNameMenu: v }),

  // Helper functions
  toggleSidebar: () => set(s => ({ isSidebarVisible: !s.isSidebarVisible })),
  toggleRightPane: () => set(s => ({ isRightPaneVisible: !s.isRightPaneVisible })),
  toggleCommandBar: () => set(s => ({ isCommandBarVisible: !s.isCommandBarVisible })),
  toggleCommandPalette: () => set(s => ({ isCommandPaletteVisible: !s.isCommandPaletteVisible })),
  showBottomPane: tab =>
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
      folderHeaderContextMenu: null,
      projectNameMenu: null,
    }),
  setActiveView: view => {
    set({
      isGitViewActive: view === "git",
      isSearchViewActive: view === "search",
      isRemoteViewActive: view === "remote",
    });
  },
}));

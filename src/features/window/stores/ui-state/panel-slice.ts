import type { StateCreator } from "zustand";
import type { BottomPaneTab } from "@/features/window/stores/ui-state/types";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useSessionStore } from "@/features/window/stores/session-store";
import { DEFAULT_PROJECT_UI_STATE } from "@/features/window/stores/workspace-ui-session";

export interface PanelState {
  isSidebarVisible: boolean;
  isFindVisible: boolean;
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: BottomPaneTab;
}

export interface PanelActions {
  setIsSidebarVisible: (v: boolean) => void;
  setIsFindVisible: (v: boolean) => void;
  setIsBottomPaneVisible: (v: boolean) => void;
  setBottomPaneActiveTab: (tab: BottomPaneTab) => void;
}

export type PanelSlice = PanelState & PanelActions;

export const createPanelSlice: StateCreator<PanelSlice, [], [], PanelSlice> = (set, get) => ({
  // State
  isSidebarVisible: true,
  isFindVisible: false,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",

  // Actions
  setIsSidebarVisible: (v: boolean) => {
    set({ isSidebarVisible: v });
    const projectPath = useProjectStore.getState().rootFolderPath;
    if (projectPath) {
      const state = get() as PanelSlice & { activeSidebarView?: string };
      useSessionStore.getState().saveUiState(projectPath, {
        isSidebarVisible: v,
        isBottomPaneVisible: get().isBottomPaneVisible,
        bottomPaneActiveTab: get().bottomPaneActiveTab,
        activeSidebarView: state.activeSidebarView ?? DEFAULT_PROJECT_UI_STATE.activeSidebarView,
      });
    }
  },
  setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),
  setIsBottomPaneVisible: (v: boolean) => {
    set({ isBottomPaneVisible: v });
    const projectPath = useProjectStore.getState().rootFolderPath;
    if (projectPath) {
      const state = get() as PanelSlice & { activeSidebarView?: string };
      useSessionStore.getState().saveUiState(projectPath, {
        isSidebarVisible: get().isSidebarVisible,
        isBottomPaneVisible: v,
        bottomPaneActiveTab: get().bottomPaneActiveTab,
        activeSidebarView: state.activeSidebarView ?? DEFAULT_PROJECT_UI_STATE.activeSidebarView,
      });
    }
  },
  setBottomPaneActiveTab: (tab: BottomPaneTab) => {
    set({ bottomPaneActiveTab: tab });
    const projectPath = useProjectStore.getState().rootFolderPath;
    if (projectPath) {
      const state = get() as PanelSlice & { activeSidebarView?: string };
      useSessionStore.getState().saveUiState(projectPath, {
        isSidebarVisible: get().isSidebarVisible,
        isBottomPaneVisible: get().isBottomPaneVisible,
        bottomPaneActiveTab: tab,
        activeSidebarView: state.activeSidebarView ?? DEFAULT_PROJECT_UI_STATE.activeSidebarView,
      });
    }
  },
});

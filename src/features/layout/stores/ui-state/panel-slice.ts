import type { StateCreator } from "zustand";
import type { BottomPaneTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";

interface PanelState {
  isSidebarVisible: boolean;
  isFindVisible: boolean;
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: BottomPaneTab;
}

interface PanelActions {
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
      workspaceSessionRepository.saveUi(projectPath, {
        isSidebarVisible: v,
        isBottomPaneVisible: get().isBottomPaneVisible,
        bottomPaneActiveTab: get().bottomPaneActiveTab,
      });
    }
  },
  setIsFindVisible: (v: boolean) => set({ isFindVisible: v }),
  setIsBottomPaneVisible: (v: boolean) => {
    set({ isBottomPaneVisible: v });
    const projectPath = useProjectStore.getState().rootFolderPath;
    if (projectPath) {
      workspaceSessionRepository.saveUi(projectPath, {
        isSidebarVisible: get().isSidebarVisible,
        isBottomPaneVisible: v,
        bottomPaneActiveTab: get().bottomPaneActiveTab,
      });
    }
  },
  setBottomPaneActiveTab: (tab: BottomPaneTab) => {
    set({ bottomPaneActiveTab: tab });
    const projectPath = useProjectStore.getState().rootFolderPath;
    if (projectPath) {
      workspaceSessionRepository.saveUi(projectPath, {
        isSidebarVisible: get().isSidebarVisible,
        isBottomPaneVisible: get().isBottomPaneVisible,
        bottomPaneActiveTab: tab,
      });
    }
  },
});

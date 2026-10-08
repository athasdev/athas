import type { StateCreator } from "zustand";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { BottomPaneTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import { DEFAULT_PROJECT_UI_STATE } from "@/features/workspace/persistence/workspace-ui-defaults";

interface ViewState {
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  activeSidebarView: SidebarView;
  activeRightSidebarView: SidebarView;
}

interface ViewActions {
  setActiveView: (view: SidebarView) => void;
  setActiveRightSidebarView: (view: SidebarView) => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set, get) => ({
  isGitViewActive: false,
  isGitHubPRsViewActive: false,
  activeSidebarView: "files",
  activeRightSidebarView: "agent",

  setActiveView: (view: SidebarView) => {
    set({
      isGitViewActive: view === "git",
      isGitHubPRsViewActive: view === "github-prs",
      activeSidebarView: view,
    });

    const projectPath = useProjectStore.getState().rootFolderPath;
    if (!projectPath) {
      return;
    }

    const state = get() as ViewSlice & {
      isSidebarVisible?: boolean;
      isBottomPaneVisible?: boolean;
      bottomPaneActiveTab?: BottomPaneTab;
    };

    workspaceSessionRepository.saveUi(projectPath, {
      isSidebarVisible: state.isSidebarVisible ?? DEFAULT_PROJECT_UI_STATE.isSidebarVisible,
      isBottomPaneVisible:
        state.isBottomPaneVisible ?? DEFAULT_PROJECT_UI_STATE.isBottomPaneVisible,
      bottomPaneActiveTab:
        state.bottomPaneActiveTab ?? DEFAULT_PROJECT_UI_STATE.bottomPaneActiveTab,
      activeSidebarView: view,
    });
  },
  setActiveRightSidebarView: (view: SidebarView) => {
    set({ activeRightSidebarView: view });
  },
});

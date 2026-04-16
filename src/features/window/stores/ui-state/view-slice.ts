import type { StateCreator } from "zustand";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useSessionStore } from "@/features/window/stores/session-store";
import { DEFAULT_PROJECT_UI_STATE } from "@/features/window/stores/workspace-ui-session";

export interface ViewState {
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  activeSidebarView: SidebarView;
}

export interface ViewActions {
  setActiveView: (view: SidebarView) => void;
}

export type ViewSlice = ViewState & ViewActions;

export const createViewSlice: StateCreator<ViewSlice, [], [], ViewSlice> = (set, get) => ({
  isGitViewActive: false,
  isGitHubPRsViewActive: false,
  activeSidebarView: "files",

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
      bottomPaneActiveTab?: "terminal" | "diagnostics";
    };

    useSessionStore.getState().saveUiState(projectPath, {
      isSidebarVisible: state.isSidebarVisible ?? DEFAULT_PROJECT_UI_STATE.isSidebarVisible,
      isBottomPaneVisible:
        state.isBottomPaneVisible ?? DEFAULT_PROJECT_UI_STATE.isBottomPaneVisible,
      bottomPaneActiveTab:
        state.bottomPaneActiveTab ?? DEFAULT_PROJECT_UI_STATE.bottomPaneActiveTab,
      activeSidebarView: view,
    });
  },
});

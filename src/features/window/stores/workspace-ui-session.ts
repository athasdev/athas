import { useSessionStore, type ProjectUiSession } from "@/features/window/stores/session-store";
import { useUIState } from "@/features/window/stores/ui-state-store";

export const DEFAULT_PROJECT_UI_STATE: ProjectUiSession = {
  isSidebarVisible: true,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",
  activeSidebarView: "files",
};

export const getCurrentProjectUiState = (): ProjectUiSession => {
  const uiState = useUIState.getState();

  return {
    isSidebarVisible: uiState.isSidebarVisible,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    activeSidebarView: uiState.activeSidebarView,
  };
};

export const persistCurrentProjectUiState = (projectPath: string | undefined) => {
  if (!projectPath) {
    return;
  }

  useSessionStore.getState().saveUiState(projectPath, getCurrentProjectUiState());
};

export const restoreProjectUiState = (projectPath: string | undefined) => {
  const uiState = useSessionStore.getState().getUiState(projectPath || "");
  const nextUiState = uiState ?? DEFAULT_PROJECT_UI_STATE;
  const state = useUIState.getState();

  state.setIsSidebarVisible(nextUiState.isSidebarVisible);
  state.setIsBottomPaneVisible(nextUiState.isBottomPaneVisible);
  state.setBottomPaneActiveTab(nextUiState.bottomPaneActiveTab);
  state.setActiveView(nextUiState.activeSidebarView);
};

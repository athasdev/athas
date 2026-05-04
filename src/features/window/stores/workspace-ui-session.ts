import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { useSessionStore, type ProjectUiSession } from "@/features/window/stores/session-store";
import {
  buildCurrentProjectPaneSession,
  buildPaneLayoutFromSession,
} from "@/features/window/stores/workspace-pane-session";
import { useUIState } from "@/features/window/stores/ui-state-store";

export const DEFAULT_PROJECT_UI_STATE: ProjectUiSession = {
  isSidebarVisible: true,
  isBottomPaneVisible: false,
  bottomPaneActiveTab: "terminal",
  activeSidebarView: "files",
  paneState: null,
};

export const getCurrentProjectUiState = (): ProjectUiSession => {
  const uiState = useUIState.getState();
  const buffers = useBufferStore.getState().buffers;
  const paneState = usePaneStore.getState();

  return {
    isSidebarVisible: uiState.isSidebarVisible,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    activeSidebarView: uiState.activeSidebarView,
    paneState: buildCurrentProjectPaneSession(paneState, buffers),
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

export const restoreProjectPaneState = (projectPath: string | undefined) => {
  const uiState = useSessionStore.getState().getUiState(projectPath || "");
  const buffers = useBufferStore.getState().buffers;
  const paneLayout = buildPaneLayoutFromSession(uiState?.paneState, buffers);
  usePaneStore.getState().actions.restoreLayout(paneLayout);
};

import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import type { ProjectUiSession } from "@/features/window/stores/session.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import {
  buildCurrentProjectPaneSession,
  buildPaneLayoutFromSession,
} from "@/features/window/stores/workspace-pane-session";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { DEFAULT_PROJECT_UI_STATE } from "@/features/window/stores/workspace-ui-defaults";

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

  workspaceSessionRepository.saveUi(projectPath, getCurrentProjectUiState());
};

export const restoreProjectUiState = (projectPath: string | undefined, workspaceId?: string) => {
  const uiState = workspaceSessionRepository.loadUi(projectPath);
  const nextUiState = uiState ?? DEFAULT_PROJECT_UI_STATE;
  const state = workspaceId ? useUIState.getStore(workspaceId).getState() : useUIState.getState();
  const legacyDebuggerSidebar = nextUiState.activeSidebarView === "debugger";
  const legacyToolBufferSidebar =
    legacyDebuggerSidebar || nextUiState.activeSidebarView === "extensions";

  state.setIsSidebarVisible(nextUiState.isSidebarVisible);
  state.setIsBottomPaneVisible(legacyDebuggerSidebar ? true : nextUiState.isBottomPaneVisible);
  state.setBottomPaneActiveTab(
    legacyDebuggerSidebar ? "debugger" : nextUiState.bottomPaneActiveTab,
  );
  state.setActiveView(legacyToolBufferSidebar ? "files" : nextUiState.activeSidebarView);
};

export const restoreProjectPaneState = (projectPath: string | undefined, workspaceId?: string) => {
  const uiState = workspaceSessionRepository.loadUi(projectPath);
  const buffers = workspaceId
    ? useBufferStore.getStore(workspaceId).getState().buffers
    : useBufferStore.getState().buffers;
  const paneLayout = buildPaneLayoutFromSession(uiState?.paneState, buffers);
  const paneStore = workspaceId ? usePaneStore.getStore(workspaceId) : usePaneStore;
  paneStore.getState().actions.restoreLayout(paneLayout);
};

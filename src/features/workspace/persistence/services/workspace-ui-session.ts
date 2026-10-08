import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { type ProjectUiSession, useSessionStore } from "@/features/workspace/stores/session.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import {
  buildCurrentProjectPaneSession,
  buildPaneLayoutFromSession,
} from "@/features/workspace/persistence/workspace-pane-session";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { DEFAULT_PROJECT_UI_STATE } from "@/features/workspace/persistence/services/workspace-ui-defaults";
import {
  selectActiveBufferId,
  selectPaneBufferFlags,
} from "@/features/panes/stores/pane-selectors";

export const getCurrentProjectUiState = (workspaceId?: string): ProjectUiSession => {
  const uiState = workspaceId ? useUIState.getStore(workspaceId).getState() : useUIState.getState();
  const buffers = workspaceId
    ? useBufferStore.getStore(workspaceId).getState().buffers
    : useBufferStore.getState().buffers;
  const paneState = workspaceId
    ? usePaneStore.getStore(workspaceId).getState()
    : usePaneStore.getState();

  return {
    isSidebarVisible: uiState.isSidebarVisible,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    activeSidebarView: uiState.activeSidebarView,
    paneState: buildCurrentProjectPaneSession(paneState, buffers),
  };
};

export const persistCurrentProjectUiState = (
  projectPath: string | undefined,
  workspaceId?: string,
) => {
  if (!projectPath) {
    return;
  }

  workspaceSessionRepository.saveUi(projectPath, getCurrentProjectUiState(workspaceId));
};

export const restoreProjectUiState = (projectPath: string | undefined, workspaceId?: string) => {
  const uiState = workspaceSessionRepository.loadUi(projectPath);
  const nextUiState = uiState ?? DEFAULT_PROJECT_UI_STATE;
  const state = workspaceId ? useUIState.getStore(workspaceId).getState() : useUIState.getState();
  const legacyDebuggerSidebar = nextUiState.activeSidebarView === "debugger";
  const legacyToolBufferSidebar =
    legacyDebuggerSidebar ||
    nextUiState.activeSidebarView === "extensions" ||
    nextUiState.activeSidebarView === "settings";
  const activeSidebarView =
    nextUiState.activeSidebarView === "data-sources" ? "views" : nextUiState.activeSidebarView;

  state.setIsSidebarVisible(nextUiState.isSidebarVisible);
  state.setIsBottomPaneVisible(legacyDebuggerSidebar ? true : nextUiState.isBottomPaneVisible);
  state.setBottomPaneActiveTab(
    legacyDebuggerSidebar ? "debugger" : nextUiState.bottomPaneActiveTab,
  );
  state.setActiveView(legacyToolBufferSidebar ? "files" : activeSidebarView);
};

export const restoreProjectPaneState = (projectPath: string | undefined, workspaceId?: string) => {
  const uiState = workspaceSessionRepository.loadUi(projectPath);
  const buffers = workspaceId
    ? useBufferStore.getStore(workspaceId).getState().buffers
    : useBufferStore.getState().buffers;
  const paneStore = workspaceId ? usePaneStore.getStore(workspaceId) : usePaneStore;
  // The buffers were reopened into the live layout first; keep the tab state that gave them.
  const restoredLayout = paneStore.getState();
  const paneLayout = buildPaneLayoutFromSession(uiState?.paneState, buffers, {
    activeBufferId: selectActiveBufferId(restoredLayout),
    ...selectPaneBufferFlags(restoredLayout),
    legacyTabOrder: projectPath
      ? useSessionStore
          .getState()
          .actions.getSession(projectPath)
          ?.buffers.map((buffer) => buffer.path)
      : undefined,
  });
  paneStore.getState().actions.restoreLayout(paneLayout);
};

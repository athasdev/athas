import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { type ProjectUiSession, useSessionStore } from "@/features/workspace/stores/session.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import {
  buildCurrentProjectPaneSession,
  buildPaneLayoutFromSession,
} from "@/features/workspace/persistence/workspace-pane-session";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import {
  getTabSetBufferIds,
  PROJECT_TAB_SET,
  type TabSetLayout,
  useTabSetsStore,
} from "@/features/panes/stores/tab-sets.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type {
  ProjectPaneSession,
  ProjectTabSetsSession,
} from "@/features/workspace/stores/session.store";
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

  const tabSets = workspaceId
    ? useTabSetsStore.getStore(workspaceId).getState()
    : useTabSetsStore.getState();

  return {
    isSidebarVisible: uiState.isSidebarVisible,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    paneState: buildCurrentProjectPaneSession(paneState, buffers),
    tabSets: {
      activeOwner: tabSets.activeOwner,
      layouts: Object.fromEntries(
        Object.entries(tabSets.stored).map(([owner, layout]) => [
          owner,
          serializeTabSet(layout, buffers),
        ]),
      ),
    },
  };
};

const EMPTY_BOTTOM_ROOT = {
  id: BOTTOM_PANE_ID,
  type: "group" as const,
  bufferIds: [],
  activeBufferId: null,
};

function serializeTabSet(layout: TabSetLayout, buffers: PaneContent[]): ProjectPaneSession {
  return buildCurrentProjectPaneSession({ ...layout, bottomRoot: EMPTY_BOTTOM_ROOT }, buffers);
}

function hydrateTabSet(paneState: ProjectPaneSession, buffers: PaneContent[]): TabSetLayout {
  const { root, activePaneId, mostRecentActivePaneIds, fullscreenPaneId } =
    buildPaneLayoutFromSession(paneState, buffers, { attachMissing: false });
  return { root, activePaneId, mostRecentActivePaneIds, fullscreenPaneId };
}

/**
 * The saved tab sets, as the restore needs them: the project's layout shows (a session's tabs
 * don't come back on screen by themselves) and every other set is kept aside.
 */
function splitSavedTabSets(
  activePaneState: ProjectPaneSession | null | undefined,
  saved: ProjectTabSetsSession | null | undefined,
): { project: ProjectPaneSession | null | undefined; others: Record<string, ProjectPaneSession> } {
  if (!saved || saved.activeOwner === PROJECT_TAB_SET) {
    return { project: activePaneState, others: saved?.layouts ?? {} };
  }
  const others: Record<string, ProjectPaneSession> = { ...saved.layouts };
  const project = others[PROJECT_TAB_SET] ?? null;
  delete others[PROJECT_TAB_SET];
  if (activePaneState) others[saved.activeOwner] = activePaneState;
  return { project, others };
}

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
  // Sessions saved before the dock remember the sidebar view; the debugger one became a tab.
  const legacyDebuggerSidebar =
    (nextUiState as { activeSidebarView?: string }).activeSidebarView === "debugger";

  state.setIsSidebarVisible(nextUiState.isSidebarVisible);
  state.setIsBottomPaneVisible(legacyDebuggerSidebar ? true : nextUiState.isBottomPaneVisible);
  state.setBottomPaneActiveTab(
    legacyDebuggerSidebar ? "debugger" : nextUiState.bottomPaneActiveTab,
  );
};

export const restoreProjectPaneState = (projectPath: string | undefined, workspaceId?: string) => {
  const uiState = workspaceSessionRepository.loadUi(projectPath);
  const buffers = workspaceId
    ? useBufferStore.getStore(workspaceId).getState().buffers
    : useBufferStore.getState().buffers;
  const paneStore = workspaceId ? usePaneStore.getStore(workspaceId) : usePaneStore;
  const tabSetsStore = workspaceId ? useTabSetsStore.getStore(workspaceId) : useTabSetsStore;
  const { project, others } = splitSavedTabSets(uiState?.paneState, uiState?.tabSets);
  const stored = Object.fromEntries(
    Object.entries(others).map(([owner, paneState]) => [owner, hydrateTabSet(paneState, buffers)]),
  );
  const heldElsewhere = new Set(Object.values(stored).flatMap(getTabSetBufferIds));
  // The buffers were reopened into the live layout first; keep the tab state that gave them.
  const restoredLayout = paneStore.getState();
  const paneLayout = buildPaneLayoutFromSession(project, buffers, {
    activeBufferId: selectActiveBufferId(restoredLayout),
    ...selectPaneBufferFlags(restoredLayout),
    excludeBufferIds: heldElsewhere,
    legacyTabOrder: projectPath
      ? useSessionStore
          .getState()
          .actions.getSession(projectPath)
          ?.buffers.map((buffer) => buffer.path)
      : undefined,
  });
  tabSetsStore.getState().actions.restore(stored);
  paneStore.getState().actions.restoreLayout(paneLayout);
};

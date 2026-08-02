import { usePaneStore } from "@/features/panes/stores/pane.store";
import type { PaneGroup } from "@/features/panes/types/pane.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { ensureBufferInPane } from "@/features/panes/utils/pane-buffer-actions";
import { resolveWritablePaneForBuffer } from "@/features/panes/utils/pane-routing";
import { createPaneBeside } from "@/features/panes/utils/pane-split-actions";

const getPaneState = (workspaceId?: string) =>
  workspaceId ? usePaneStore.getStore(workspaceId).getState() : usePaneStore.getState();

export const getWritablePaneForBuffer = (
  bufferId?: string,
  workspaceId?: string,
): PaneGroup | null => {
  const paneStore = getPaneState(workspaceId);
  const activePane = paneStore.actions.getActivePane();
  if (!activePane) return null;

  const writablePane = resolveWritablePaneForBuffer({
    activePane,
    bottomRoot: paneStore.bottomRoot,
    bufferId,
    mostRecentActivePaneIds: paneStore.mostRecentActivePaneIds,
    root: paneStore.root,
  });
  if (writablePane) return writablePane;

  const newPaneId = createPaneBeside(activePane.id, "horizontal", "after", undefined, workspaceId);
  return newPaneId ? paneStore.actions.getPaneById(newPaneId) : activePane;
};

export const syncBufferToPane = (bufferId: string, workspaceId?: string) => {
  const targetPane = getWritablePaneForBuffer(bufferId, workspaceId);
  if (!targetPane) return;

  ensureBufferInPane(targetPane.id, bufferId, true, workspaceId);
};

export const syncAndFocusBufferInPane = (bufferId: string, workspaceId?: string) => {
  const paneStore = getPaneState(workspaceId);
  const paneWithBuffer = paneStore.actions.getPaneByBufferId(bufferId);

  if (paneWithBuffer) {
    ensureBufferInPane(paneWithBuffer.id, bufferId, true, workspaceId);
    return;
  }

  syncBufferToPane(bufferId, workspaceId);
};

export const syncPanePreviewForBuffer = (
  bufferId: string,
  isPreview: boolean,
  workspaceId?: string,
) => {
  const paneStore = getPaneState(workspaceId);
  if (!isPreview) {
    paneStore.actions.clearPreviewBufferEverywhere(bufferId);
    return;
  }

  const activePane = paneStore.actions.getActivePane();
  if (activePane?.bufferIds.includes(bufferId)) {
    paneStore.actions.setPanePreviewBuffer(activePane.id, bufferId);
  }
};

export const removeBufferFromPanes = (
  bufferId: string,
  preserveEmptyPane = false,
  workspaceId?: string,
) => {
  const paneStore = getPaneState(workspaceId);
  for (const pane of paneStore.actions.getAllPaneGroups()) {
    if (pane.bufferIds.includes(bufferId)) {
      paneStore.actions.removeBufferFromPane(pane.id, bufferId, preserveEmptyPane);
    }
  }
};

export const closeNewTabInActivePane = (
  buffers: PaneContent[],
  workspaceId?: string,
): PaneContent[] => {
  const paneStore = getPaneState(workspaceId);
  const activePane = paneStore.actions.getActivePane();
  const paneBufferIds = activePane?.bufferIds ?? [];
  const newTabBuffer = buffers.find((buffer) => {
    return buffer.type === "newTab" && paneBufferIds.includes(buffer.id);
  });

  if (!newTabBuffer) {
    return buffers;
  }

  removeBufferFromPanes(newTabBuffer.id, true, workspaceId);
  return buffers.filter((buffer) => buffer.id !== newTabBuffer.id);
};

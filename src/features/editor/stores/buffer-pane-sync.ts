import { usePaneStore } from "@/features/panes/stores/pane-store";
import type { PaneGroup } from "@/features/panes/types/pane";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { ensureBufferInPane } from "@/features/panes/utils/pane-buffer-actions";
import { resolveWritablePaneForBuffer } from "@/features/panes/utils/pane-routing";
import { createPaneBeside } from "@/features/panes/utils/pane-split-actions";

export const getWritablePaneForBuffer = (bufferId?: string): PaneGroup | null => {
  const paneStore = usePaneStore.getState();
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

  const newPaneId = createPaneBeside(activePane.id, "horizontal");
  return newPaneId ? paneStore.actions.getPaneById(newPaneId) : activePane;
};

export const syncBufferToPane = (bufferId: string) => {
  const targetPane = getWritablePaneForBuffer(bufferId);
  if (!targetPane) return;

  ensureBufferInPane(targetPane.id, bufferId, true);
};

export const syncAndFocusBufferInPane = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const paneWithBuffer = paneStore.actions.getPaneByBufferId(bufferId);

  if (paneWithBuffer) {
    ensureBufferInPane(paneWithBuffer.id, bufferId, true);
    return;
  }

  syncBufferToPane(bufferId);
};

export const syncPanePreviewForBuffer = (bufferId: string, isPreview: boolean) => {
  const paneStore = usePaneStore.getState();
  if (!isPreview) {
    paneStore.actions.clearPreviewBufferEverywhere(bufferId);
    return;
  }

  const activePane = paneStore.actions.getActivePane();
  if (activePane?.bufferIds.includes(bufferId)) {
    paneStore.actions.setPanePreviewBuffer(activePane.id, bufferId);
  }
};

export const removeBufferFromPanes = (bufferId: string, preserveEmptyPane = false) => {
  const paneStore = usePaneStore.getState();
  for (const pane of paneStore.actions.getAllPaneGroups()) {
    if (pane.bufferIds.includes(bufferId)) {
      paneStore.actions.removeBufferFromPane(pane.id, bufferId, preserveEmptyPane);
    }
  }
};

export const closeNewTabInActivePane = (buffers: PaneContent[]): PaneContent[] => {
  const paneStore = usePaneStore.getState();
  const activePane = paneStore.actions.getActivePane();
  const paneBufferIds = activePane?.bufferIds ?? [];
  const newTabBuffer = buffers.find((buffer) => {
    return buffer.type === "newTab" && paneBufferIds.includes(buffer.id);
  });

  if (!newTabBuffer) {
    return buffers;
  }

  removeBufferFromPanes(newTabBuffer.id);
  return buffers.filter((buffer) => buffer.id !== newTabBuffer.id);
};

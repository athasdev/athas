import { usePaneStore } from "@/features/panes/stores/pane-store";
import type { PaneContent } from "@/features/panes/types/pane-content";

export const syncBufferToPane = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const activePane = paneStore.actions.getActivePane();
  if (activePane && !activePane.bufferIds.includes(bufferId)) {
    paneStore.actions.addBufferToPane(activePane.id, bufferId);
  } else if (activePane) {
    paneStore.actions.setActivePaneBuffer(activePane.id, bufferId);
  }
};

export const syncAndFocusBufferInPane = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const paneWithBuffer = paneStore.actions.getPaneByBufferId(bufferId);

  if (paneWithBuffer) {
    paneStore.actions.setActivePane(paneWithBuffer.id);
    paneStore.actions.setActivePaneBuffer(paneWithBuffer.id, bufferId);
    return;
  }

  syncBufferToPane(bufferId);
};

export const removeBufferFromPanes = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  for (const pane of paneStore.actions.getAllPaneGroups()) {
    if (pane.bufferIds.includes(bufferId)) {
      paneStore.actions.removeBufferFromPane(pane.id, bufferId);
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

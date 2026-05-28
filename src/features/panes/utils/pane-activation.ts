import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { usePaneStore } from "../stores/pane-store";
import { ensureBufferInPane } from "./pane-buffer-actions";

export function activatePaneAndSyncBuffer(paneId: string) {
  const paneStore = usePaneStore.getState();
  paneStore.actions.setActivePane(paneId);

  const activePane = paneStore.actions.getPaneById(paneId);
  if (!activePane?.activeBufferId) {
    return;
  }

  const bufferStore = useBufferStore.getState();
  if (bufferStore.activeBufferId !== activePane.activeBufferId) {
    bufferStore.actions.setActiveBuffer(activePane.activeBufferId);
  }
}

export function activateBufferInPaneAndSync(paneId: string, bufferId: string) {
  ensureBufferInPane(paneId, bufferId, true);
  const bufferStore = useBufferStore.getState();
  if (bufferStore.activeBufferId !== bufferId) {
    bufferStore.actions.setActiveBuffer(bufferId);
  }
}

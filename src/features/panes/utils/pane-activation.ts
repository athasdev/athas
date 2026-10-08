import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { usePaneStore } from "../stores/pane.store";

/** Focuses a pane; its active tab becomes the workbench's active buffer. */
export function activatePaneAndSyncBuffer(paneId: string) {
  const paneActions = usePaneStore.getState().actions;
  const activeBufferId = paneActions.getPaneById(paneId)?.activeBufferId;
  if (activeBufferId) {
    useBufferStore.getState().actions.setActiveBuffer(activeBufferId, paneId);
    return;
  }

  paneActions.setActivePane(paneId);
}

/** Shows a buffer in a pane (adding it when the pane lacks it), activates it and focuses the pane. */
export function activateBufferInPaneAndSync(paneId: string, bufferId: string) {
  useBufferStore.getState().actions.setActiveBuffer(bufferId, paneId);
}

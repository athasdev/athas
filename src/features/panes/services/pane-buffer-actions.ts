import { usePaneStore } from "../stores/pane.store";

/** Puts a buffer in a pane, by default activating it and focusing the pane in the same update. */
export function ensureBufferInPane(
  paneId: string,
  bufferId: string,
  setActive = true,
  workspaceId?: string,
): string | null {
  const paneActions = (
    workspaceId ? usePaneStore.getStore(workspaceId).getState() : usePaneStore.getState()
  ).actions;
  const pane = paneActions.getPaneById(paneId);
  if (!pane) {
    return null;
  }

  if (setActive) {
    paneActions.placeBuffer(bufferId, { paneId });
  } else if (!pane.bufferIds.includes(bufferId)) {
    paneActions.addBufferToPane(paneId, bufferId, false);
  }

  return paneId;
}

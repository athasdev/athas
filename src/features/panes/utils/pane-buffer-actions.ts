import { usePaneStore } from "../stores/pane.store";

export function ensureBufferInPane(
  paneId: string,
  bufferId: string,
  setActive = true,
): string | null {
  const paneActions = usePaneStore.getState().actions;
  const pane = paneActions.getPaneById(paneId);
  if (!pane) {
    return null;
  }

  if (!pane.bufferIds.includes(bufferId)) {
    paneActions.addBufferToPane(paneId, bufferId, setActive);
    if (setActive) {
      paneActions.activatePaneBuffer(paneId, bufferId);
    }
  } else if (setActive) {
    paneActions.activatePaneBuffer(paneId, bufferId);
  }

  return paneId;
}

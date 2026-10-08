import { usePaneStore } from "../stores/pane.store";
import type { SplitDirection, SplitPlacement } from "../types/pane.types";

export function createPaneBeside(
  paneId: string,
  direction: SplitDirection,
  placement: SplitPlacement = "after",
  bufferId?: string,
  workspaceId?: string,
): string | null {
  const paneActions = (
    workspaceId ? usePaneStore.getStore(workspaceId).getState() : usePaneStore.getState()
  ).actions;
  return paneActions.splitPane(paneId, direction, bufferId, placement) ?? null;
}

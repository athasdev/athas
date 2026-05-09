import { usePaneStore } from "../stores/pane-store";
import type { SplitDirection, SplitPlacement } from "../types/pane";

export function createPaneBeside(
  paneId: string,
  direction: SplitDirection,
  placement: SplitPlacement = "after",
  bufferId?: string,
): string | null {
  return usePaneStore.getState().actions.splitPane(paneId, direction, bufferId, placement) ?? null;
}

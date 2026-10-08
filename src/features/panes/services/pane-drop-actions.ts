import { usePaneStore } from "../stores/pane.store";
import type { PaneDropZone } from "./pane-drop-zones";
import { getPaneSplitDropOptions } from "./pane-drop-zones";
import { createPaneBeside } from "./pane-split-actions";

interface PaneDropTarget {
  paneId: string;
  zone: PaneDropZone;
}

export function getOrCreatePaneDropTarget(target: PaneDropTarget): string | null {
  const splitOptions = getPaneSplitDropOptions(target.zone);
  if (!splitOptions) {
    return target.paneId;
  }

  return createPaneBeside(target.paneId, splitOptions.direction, splitOptions.placement);
}

export function moveBufferToPaneDropTarget(
  bufferId: string,
  sourcePaneId: string,
  target: PaneDropTarget,
  preserveEmptySource: boolean = target.paneId === sourcePaneId,
): string | null {
  const targetPaneId = getOrCreatePaneDropTarget(target);
  if (!targetPaneId) {
    return null;
  }

  usePaneStore
    .getState()
    .actions.moveBufferToPane(bufferId, sourcePaneId, targetPaneId, preserveEmptySource);
  return targetPaneId;
}

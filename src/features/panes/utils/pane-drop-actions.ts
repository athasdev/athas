import { usePaneStore } from "../stores/pane-store";
import { ensureBufferInPane } from "./pane-buffer-actions";
import type { PaneDropZone } from "./pane-drop-zones";
import { getPaneSplitDropOptions } from "./pane-drop-zones";
import { createPaneBeside } from "./pane-split-actions";

export interface PaneDropTarget {
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

export function ensureBufferInPaneDropTarget(
  bufferId: string,
  target: PaneDropTarget,
): string | null {
  const targetPaneId = getOrCreatePaneDropTarget(target);
  if (!targetPaneId) {
    return null;
  }

  return ensureBufferInPane(targetPaneId, bufferId, true);
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

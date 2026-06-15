import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID } from "../constants/pane";
import { usePaneStore } from "../stores/pane.store";
import type { PaneNode } from "../types/pane.types";
import { getPaneScopeForPaneId } from "./pane-routing";
import { createPaneBeside } from "./pane-split-actions";
import { getAllPaneGroups } from "./pane-tree";

export const getShareableSplitBufferId = (bufferId: string | null | undefined) => {
  if (!bufferId) return undefined;
  const activeBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.id === bufferId);
  if (
    activeBuffer?.type === "terminal" ||
    activeBuffer?.type === "agent" ||
    activeBuffer?.type === "webViewer"
  ) {
    return undefined;
  }

  return bufferId;
};

function isEditorPaneId(paneId: string): boolean {
  if (paneId === BOTTOM_PANE_ID) {
    return false;
  }

  return getAllPaneGroups(usePaneStore.getState().root).some((pane) => pane.id === paneId);
}

function getActiveEditorPane() {
  const paneStore = usePaneStore.getState();
  const activePane = paneStore.actions.getActivePane();
  if (!activePane || !isEditorPaneId(activePane.id)) {
    return null;
  }

  return activePane;
}

export function toggleActiveEditorGroupLock(): boolean {
  const paneStore = usePaneStore.getState();
  const activePane = getActiveEditorPane();
  if (!activePane) {
    return false;
  }

  paneStore.actions.setPaneLocked(activePane.id, !activePane.locked);
  return true;
}

export function splitActiveEditorGroup(direction: "horizontal" | "vertical"): boolean {
  const activePane = getActiveEditorPane();
  if (!activePane) {
    return false;
  }

  return splitEditorGroup(activePane.id, direction, activePane.activeBufferId);
}

export function splitEditorGroup(
  paneId: string,
  direction: "horizontal" | "vertical",
  bufferId?: string | null,
): boolean {
  if (!isEditorPaneId(paneId)) {
    return false;
  }

  return Boolean(createPaneBeside(paneId, direction, "after", getShareableSplitBufferId(bufferId)));
}

export function closeActiveEditorGroup(): boolean {
  const paneStore = usePaneStore.getState();
  const activePane = getActiveEditorPane();
  if (!activePane) {
    return false;
  }

  const paneGroups = getPaneScopeForPaneId(paneStore.root, paneStore.bottomRoot, activePane.id);
  if (paneGroups.length <= 1) {
    return false;
  }

  paneStore.actions.closePane(activePane.id);
  return true;
}

export function closeOtherEditorGroups(): boolean {
  const paneStore = usePaneStore.getState();
  const activePane = getActiveEditorPane();
  if (!activePane) {
    return false;
  }

  const editorGroups = getAllPaneGroups(paneStore.root);
  if (!editorGroups.some((pane) => pane.id === activePane.id) || editorGroups.length <= 1) {
    return false;
  }

  paneStore.actions.setActivePane(activePane.id);
  for (const pane of editorGroups) {
    if (pane.id !== activePane.id) {
      paneStore.actions.closePane(pane.id);
    }
  }

  return true;
}

function collectSplitIds(node: PaneNode): string[] {
  if (node.type === "group") {
    return [];
  }

  return [node.id, ...collectSplitIds(node.children[0]), ...collectSplitIds(node.children[1])];
}

export function resetEditorGroupSizes(): boolean {
  const paneStore = usePaneStore.getState();
  const splitIds = collectSplitIds(paneStore.root);
  if (splitIds.length === 0) {
    return false;
  }

  for (const splitId of splitIds) {
    paneStore.actions.distributePaneSplit(splitId);
  }

  return true;
}

export function moveActiveEditorToAdjacentGroup(direction: "next" | "previous"): boolean {
  const paneStore = usePaneStore.getState();
  const activePane = getActiveEditorPane();
  if (!activePane || !activePane.activeBufferId) {
    return false;
  }

  const paneGroups = getPaneScopeForPaneId(paneStore.root, paneStore.bottomRoot, activePane.id);
  if (paneGroups.length <= 1) {
    return false;
  }

  const currentIndex = paneGroups.findIndex((pane) => pane.id === activePane.id);
  if (currentIndex === -1) {
    return false;
  }

  const offset = direction === "next" ? 1 : -1;
  const targetIndex = (currentIndex + offset + paneGroups.length) % paneGroups.length;
  const targetPane = paneGroups[targetIndex];
  if (!targetPane || targetPane.id === activePane.id) {
    return false;
  }

  paneStore.actions.moveBufferToPane(activePane.activeBufferId, activePane.id, targetPane.id);
  return true;
}

import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { getPaneDropZoneFromRect, type PaneDropZone } from "@/features/panes/utils/pane-drop-zones";

type InternalDropZone = PaneDropZone;

export interface InternalTabDragData {
  source?: "pane" | "terminal-panel";
  bufferId?: string;
  paneId?: string;
  terminalId?: string;
  name?: string;
  shell?: string;
  initialCommand?: string;
  currentDirectory?: string;
  remoteConnectionId?: string;
}

export interface InternalTabDragHoverTarget {
  paneId: string | null;
  zone: InternalDropZone;
}

declare global {
  interface Window {
    __athasInternalTabDragData?: InternalTabDragData;
    __athasInternalTabDragHover?: InternalTabDragHoverTarget;
  }
}

export function setInternalTabDragData(data: InternalTabDragData) {
  window.__athasInternalTabDragData = data;
}

export function getInternalTabDragData(): InternalTabDragData | null {
  return window.__athasInternalTabDragData ?? null;
}

export function clearInternalTabDragData() {
  delete window.__athasInternalTabDragData;
  delete window.__athasInternalTabDragHover;
  window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
}

export function setInternalTabDragHoverTarget(next: InternalTabDragHoverTarget) {
  const prev = window.__athasInternalTabDragHover;
  if (prev?.paneId === next.paneId && prev?.zone === next.zone) return;
  window.__athasInternalTabDragHover = next;
  window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
}

export function setInternalTabDragHover(point: { x: number; y: number }) {
  setInternalTabDragHoverTarget(resolveDropTarget(point));
}

export function getInternalTabDragHover() {
  return window.__athasInternalTabDragHover ?? { paneId: null, zone: null as InternalDropZone };
}

export function resolveDropTarget(point: { x: number; y: number }) {
  const elements = document.elementsFromPoint(point.x, point.y);
  if (elements.length === 0) {
    return { paneId: null, zone: null as InternalDropZone };
  }

  const tabBar = elements
    .map((element) => element.closest<HTMLElement>("[data-tab-bar-pane-id]"))
    .find((element) => Boolean(element?.dataset.tabBarPaneId));

  if (tabBar?.dataset.tabBarPaneId) {
    return {
      paneId: tabBar.dataset.tabBarPaneId,
      zone: "center" as InternalDropZone,
    };
  }

  const paneContainer = elements
    .map((element) => element.closest<HTMLElement>("[data-pane-id]"))
    .find((element) => Boolean(element?.dataset.paneId));

  if (paneContainer?.dataset.paneId) {
    return {
      paneId: paneContainer.dataset.paneId,
      zone: getPaneDropZoneFromRect(point, paneContainer.getBoundingClientRect()),
    };
  }

  const bottomPaneTarget = elements.find((element) =>
    Boolean(element.closest<HTMLElement>("[data-bottom-pane-drop-target]")),
  );

  if (bottomPaneTarget) {
    return {
      paneId: BOTTOM_PANE_ID,
      zone: "center" as InternalDropZone,
    };
  }

  return { paneId: null, zone: null as InternalDropZone };
}

/**
 * Where a tab dropped on a tab bar should land: the id of the tab it goes before, `null` for the
 * end of the bar, or `undefined` when the point is not over a tab bar.
 */
export function resolveTabInsertBefore(
  point: { x: number; y: number },
  draggedId: string,
): string | null | undefined {
  const tabBar = document
    .elementsFromPoint(point.x, point.y)
    .map((element) => element.closest<HTMLElement>("[data-tab-bar-pane-id]"))
    .find(Boolean);
  if (!tabBar) return undefined;

  for (const tab of tabBar.querySelectorAll<HTMLElement>("[data-sortable-id]")) {
    const id = tab.dataset.sortableId;
    if (!id || id === draggedId) continue;
    const rect = tab.getBoundingClientRect();
    if (point.x < rect.left + rect.width / 2) return id;
  }
  return null;
}

/**
 * Tabs render in the global buffer order, filtered to the pane. To put `movedId` before
 * `beforeId` (or after the pane's last tab when `beforeId` is null), returns the global
 * `[from, to]` indices for a remove-then-insert reorder, or null when nothing needs to move.
 */
export function getGlobalTabMove(
  globalIds: readonly string[],
  movedId: string,
  beforeId: string | null,
  paneIds: readonly string[],
): [number, number] | null {
  const from = globalIds.indexOf(movedId);
  if (from === -1) return null;

  // Already in place within the pane: nothing to move.
  const paneIdSet = new Set(paneIds);
  const paneOrder = globalIds.filter((id) => id === movedId || paneIdSet.has(id));
  const next = paneOrder[paneOrder.indexOf(movedId) + 1] ?? null;
  if (next === beforeId) return null;

  let target: number;
  if (beforeId) {
    target = globalIds.indexOf(beforeId);
    if (target === -1) return null;
  } else {
    let last = -1;
    globalIds.forEach((id, index) => {
      if (id !== movedId && paneIdSet.has(id)) last = index;
    });
    if (last === -1) return null;
    target = last + 1;
  }

  // Removing `from` first shifts everything after it one slot to the left.
  const to = from < target ? target - 1 : target;
  return from === to ? null : [from, to];
}

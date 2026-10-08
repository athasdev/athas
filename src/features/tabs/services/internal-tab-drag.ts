import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import { emitAppEvent } from "@/utils/app-events";
import {
  getPaneDropZoneFromRect,
  type PaneDropZone,
} from "@/features/panes/services/pane-drop-zones";

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
  emitAppEvent("tabs:internal-drag-hover");
}

export function setInternalTabDragHoverTarget(next: InternalTabDragHoverTarget) {
  const prev = window.__athasInternalTabDragHover;
  if (prev?.paneId === next.paneId && prev?.zone === next.zone) return;
  window.__athasInternalTabDragHover = next;
  emitAppEvent("tabs:internal-drag-hover");
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

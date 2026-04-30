import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";

export type InternalDropZone = "left" | "right" | "top" | "bottom" | "center" | null;

export interface InternalTabDragData {
  source?: "pane" | "terminal-panel";
  bufferId?: string;
  paneId?: string;
  terminalId?: string;
  name?: string;
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

function getDropZone(point: { x: number; y: number }, rect: DOMRect): InternalDropZone {
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  const nx = x / rect.width;
  const ny = y / rect.height;
  const threshold = 0.25;

  if (nx < threshold && nx < ny && nx < 1 - ny) return "left";
  if (nx > 1 - threshold && 1 - nx < ny && 1 - nx < 1 - ny) return "right";
  if (ny < threshold) return "top";
  if (ny > 1 - threshold) return "bottom";
  return "center";
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

export function resolveDropPaneId(point: { x: number; y: number }): string | null {
  return resolveDropTarget(point).paneId;
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
      zone: getDropZone(point, paneContainer.getBoundingClientRect()),
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

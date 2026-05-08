import { BOTTOM_PANE_ID } from "@/features/panes/constants/pane";
import type { SplitDirection, SplitPlacement } from "@/features/panes/types/pane";

export type InternalDropZone = "left" | "right" | "top" | "bottom" | "center" | null;
export type EdgeDropZone = Exclude<InternalDropZone, "center" | null>;

type ClientPoint = { x: number; y: number };

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
    __athasDragSplitSuppressed?: boolean;
    __athasDragAborted?: boolean;
  }
}

const DRAG_DOUBLE_ESC_WINDOW_MS = 600;
let lastEscAt = 0;
let dragKeyHandlersAttached = false;

function isAnyDragActive(): boolean {
  return !!window.__athasInternalTabDragData || !!window.__fileDragData;
}

function abortDrag() {
  window.__athasDragAborted = true;
  window.__athasDragSplitSuppressed = false;
  delete window.__fileDragData;
  delete window.__athasInternalTabDragData;
  delete window.__athasInternalTabDragHover;
  window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
  window.dispatchEvent(new CustomEvent("athas-drag-abort"));
}

function handleDragKeydown(event: KeyboardEvent) {
  if (!isAnyDragActive()) return;
  if (event.key !== "Escape") return;

  event.preventDefault();
  const now = performance.now();
  if (now - lastEscAt < DRAG_DOUBLE_ESC_WINDOW_MS) {
    abortDrag();
    lastEscAt = 0;
    return;
  }

  lastEscAt = now;
  window.__athasDragSplitSuppressed = true;
  const hover = window.__athasInternalTabDragHover;
  if (hover?.paneId) {
    window.__athasInternalTabDragHover = { paneId: hover.paneId, zone: "center" };
    window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
  }
}

export function attachDragKeyHandlers() {
  if (dragKeyHandlersAttached) return;
  dragKeyHandlersAttached = true;
  window.addEventListener("keydown", handleDragKeydown, true);
  window.__athasDragSplitSuppressed = false;
  window.__athasDragAborted = false;
}

export function resetDragModifierState() {
  window.__athasDragSplitSuppressed = false;
  window.__athasDragAborted = false;
  lastEscAt = 0;
}

export function isDragAborted(): boolean {
  return !!window.__athasDragAborted;
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
  resetDragModifierState();
  window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
}

export function getDropZoneForPoint(point: ClientPoint, rect: DOMRect): InternalDropZone {
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  const nx = x / rect.width;
  const ny = y / rect.height;
  const threshold = 1 / 3;

  if (nx < threshold && nx < ny && nx < 1 - ny) return "left";
  if (nx > 1 - threshold && 1 - nx < ny && 1 - nx < 1 - ny) return "right";
  if (ny < threshold) return "top";
  if (ny > 1 - threshold) return "bottom";
  return "center";
}

function containsPoint(rect: DOMRect, point: ClientPoint): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function findContainingClosest(
  elements: Element[],
  selector: string,
  point: ClientPoint,
): HTMLElement | null {
  for (const element of elements) {
    const candidate = element.closest<HTMLElement>(selector);
    if (candidate && containsPoint(candidate.getBoundingClientRect(), point)) {
      return candidate;
    }
  }
  return null;
}

function findContainingElement(selector: string, point: ClientPoint): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(selector);
  return (
    Array.from(candidates).find((candidate) =>
      containsPoint(candidate.getBoundingClientRect(), point),
    ) ?? null
  );
}

export function setInternalTabDragHoverTarget(next: InternalTabDragHoverTarget) {
  const prev = window.__athasInternalTabDragHover;
  if (prev?.paneId === next.paneId && prev?.zone === next.zone) return;
  window.__athasInternalTabDragHover = next;
  window.dispatchEvent(new CustomEvent("athas-internal-tab-drag-hover"));
}

export function setInternalTabDragHover(point: ClientPoint) {
  const target = resolveDropTarget(point);

  if (window.__athasDragSplitSuppressed && target.zone && target.zone !== "center") {
    setInternalTabDragHoverTarget({ paneId: target.paneId, zone: "center" });
    return;
  }

  setInternalTabDragHoverTarget(target);
}

export function getInternalTabDragHover(): InternalTabDragHoverTarget {
  return window.__athasInternalTabDragHover ?? { paneId: null, zone: null };
}

export function isEdgeDropZone(zone: InternalDropZone): zone is EdgeDropZone {
  return zone !== null && zone !== "center";
}

export function getSplitDropConfig(zone: EdgeDropZone): {
  direction: SplitDirection;
  placement: SplitPlacement;
} {
  return {
    direction: zone === "left" || zone === "right" ? "horizontal" : "vertical",
    placement: zone === "left" || zone === "top" ? "before" : "after",
  };
}

export function applyDropZoneGates(zone: InternalDropZone): InternalDropZone {
  if (window.__athasDragAborted) return null;
  if (zone === null || zone === "center") return zone;
  if (window.__athasDragSplitSuppressed) return "center";
  return zone;
}

export function resolveDropTarget(point: ClientPoint): InternalTabDragHoverTarget {
  const elements = document.elementsFromPoint(point.x, point.y);
  if (elements.length === 0) {
    return { paneId: null, zone: null };
  }

  const tabBar =
    findContainingClosest(elements, "[data-tab-bar-pane-id]", point) ??
    findContainingElement("[data-tab-bar-pane-id]", point);

  if (tabBar?.dataset.tabBarPaneId) {
    return {
      paneId: tabBar.dataset.tabBarPaneId,
      zone: "center",
    };
  }

  const paneContainer =
    findContainingClosest(elements, "[data-pane-id]", point) ??
    findContainingElement("[data-pane-id]", point);

  if (paneContainer?.dataset.paneId) {
    return {
      paneId: paneContainer.dataset.paneId,
      zone: getDropZoneForPoint(point, paneContainer.getBoundingClientRect()),
    };
  }

  const bottomPaneTarget = elements.find((element) =>
    Boolean(element.closest<HTMLElement>("[data-bottom-pane-drop-target]")),
  );

  if (bottomPaneTarget) {
    return {
      paneId: BOTTOM_PANE_ID,
      zone: "center",
    };
  }

  return { paneId: null, zone: null };
}

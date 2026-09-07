import type { SplitPlacement } from "@/features/panes/types/pane.types";
import { getPaneDropZoneFromRect, type PaneDropZone } from "@/features/panes/utils/pane-drop-zones";
import type { TerminalSplitDirection } from "@/features/terminal/types/terminal.types";

export interface TerminalPaneDropTarget {
  terminalId: string;
  zone: PaneDropZone;
}

export interface TerminalSplitDropOptions {
  direction: TerminalSplitDirection;
  placement: SplitPlacement;
}

export const TERMINAL_PANE_DROP_HOVER_EVENT = "athas-terminal-pane-drop-hover";

declare global {
  interface Window {
    __athasTerminalPaneDropHover?: TerminalPaneDropTarget | null;
  }
}

export function getTerminalSplitDropOptions(zone: PaneDropZone): TerminalSplitDropOptions | null {
  switch (zone) {
    case "left":
      return { direction: "right", placement: "before" };
    case "right":
      return { direction: "right", placement: "after" };
    case "top":
      return { direction: "down", placement: "before" };
    case "bottom":
      return { direction: "down", placement: "after" };
    default:
      return null;
  }
}

export function resolveTerminalPaneDropTarget(point: {
  x: number;
  y: number;
}): TerminalPaneDropTarget | null {
  const pane = document
    .elementsFromPoint(point.x, point.y)
    .map((element) => element.closest<HTMLElement>("[data-terminal-pane]"))
    .find((element) => Boolean(element?.dataset.terminalPane));
  if (!pane?.dataset.terminalPane) return null;

  const zone = getPaneDropZoneFromRect(point, pane.getBoundingClientRect());
  return { terminalId: pane.dataset.terminalPane, zone: zone === "center" ? null : zone };
}

export function setTerminalPaneDropHover(next: TerminalPaneDropTarget | null) {
  const previous = window.__athasTerminalPaneDropHover ?? null;
  if (previous?.terminalId === next?.terminalId && previous?.zone === next?.zone) return;
  window.__athasTerminalPaneDropHover = next;
  window.dispatchEvent(new CustomEvent(TERMINAL_PANE_DROP_HOVER_EVENT));
}

export function getTerminalPaneDropHover(): TerminalPaneDropTarget | null {
  return window.__athasTerminalPaneDropHover ?? null;
}

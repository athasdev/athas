import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { IS_LINUX, IS_WINDOWS } from "@/utils/platform";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface ResizeZone {
  direction: ResizeDirection;
  cursor: string;
  edge: "top" | "right" | "bottom" | "left";
  corner?: "left" | "right";
}

const EDGE_SIZE = IS_LINUX ? 8 : 5;
const CORNER_SIZE = IS_LINUX ? 16 : 10;
const SELECTION_LOCK_TIMEOUT_MS = 4000;
const RESIZE_HANDLE_Z_INDEX = 100_000;

let selectionLockTimeout: number | undefined;

type ResizeHandleStyle = CSSProperties & {
  WebkitAppRegion?: "no-drag";
  appRegion?: "no-drag";
};

const resizeZones: ResizeZone[] = [
  // Corners get larger hit targets so Linux borderless windows are resizeable
  // without requiring pixel-perfect pointer placement.
  {
    direction: "NorthWest",
    cursor: "nw-resize",
    edge: "top",
    corner: "left",
  },
  {
    direction: "NorthEast",
    cursor: "ne-resize",
    edge: "top",
    corner: "right",
  },
  {
    direction: "SouthWest",
    cursor: "sw-resize",
    edge: "bottom",
    corner: "left",
  },
  {
    direction: "SouthEast",
    cursor: "se-resize",
    edge: "bottom",
    corner: "right",
  },
  // Edges
  {
    direction: "North",
    cursor: "n-resize",
    edge: "top",
  },
  {
    direction: "South",
    cursor: "s-resize",
    edge: "bottom",
  },
  {
    direction: "West",
    cursor: "w-resize",
    edge: "left",
  },
  {
    direction: "East",
    cursor: "e-resize",
    edge: "right",
  },
];

const releaseSelectionLock = () => {
  if (selectionLockTimeout !== undefined) {
    window.clearTimeout(selectionLockTimeout);
    selectionLockTimeout = undefined;
  }

  document.documentElement.removeAttribute("data-window-resize-dragging");
};

const lockSelectionDuringResize = () => {
  window.getSelection()?.removeAllRanges();
  document.documentElement.setAttribute("data-window-resize-dragging", "true");

  window.removeEventListener("pointerup", releaseSelectionLock, true);
  window.removeEventListener("pointercancel", releaseSelectionLock, true);
  window.removeEventListener("mouseup", releaseSelectionLock, true);
  window.removeEventListener("blur", releaseSelectionLock, true);

  window.addEventListener("pointerup", releaseSelectionLock, { capture: true, once: true });
  window.addEventListener("pointercancel", releaseSelectionLock, { capture: true, once: true });
  window.addEventListener("mouseup", releaseSelectionLock, { capture: true, once: true });
  window.addEventListener("blur", releaseSelectionLock, { capture: true, once: true });

  if (selectionLockTimeout !== undefined) {
    window.clearTimeout(selectionLockTimeout);
  }
  selectionLockTimeout = window.setTimeout(releaseSelectionLock, SELECTION_LOCK_TIMEOUT_MS);
};

const handleResizeStart = async (direction: ResizeDirection) => {
  try {
    const window = getCurrentWindow();
    await window.startResizeDragging(direction);
  } catch (error) {
    console.error("Failed to start resize dragging:", error);
  }
};

const prepareResizeEvent = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
  if (event.button !== 0) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  lockSelectionDuringResize();
  return true;
};

const handleResizePointerDown = (
  event: PointerEvent<HTMLDivElement>,
  direction: ResizeDirection,
) => {
  if (!event.isPrimary || !prepareResizeEvent(event)) {
    return;
  }

  void handleResizeStart(direction);
};

const handleResizeMouseDown = (event: MouseEvent<HTMLDivElement>, direction: ResizeDirection) => {
  if (typeof window !== "undefined" && "PointerEvent" in window) {
    return;
  }

  if (!prepareResizeEvent(event)) {
    return;
  }

  void handleResizeStart(direction);
};

const getResizeZoneStyle = (zone: ResizeZone): ResizeHandleStyle => {
  const style: ResizeHandleStyle = {
    position: "fixed",
    zIndex: RESIZE_HANDLE_Z_INDEX,
    cursor: zone.cursor,
    pointerEvents: "auto",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitAppRegion: "no-drag",
    appRegion: "no-drag",
  };

  if (zone.corner) {
    style.width = CORNER_SIZE;
    style.height = CORNER_SIZE;
    style[zone.edge] = 0;
    style[zone.corner] = 0;
    return style;
  }

  if (zone.edge === "top" || zone.edge === "bottom") {
    style.height = EDGE_SIZE;
    style[zone.edge] = 0;
    style.left = CORNER_SIZE;
    style.right = CORNER_SIZE;
    return style;
  }

  style.width = EDGE_SIZE;
  style[zone.edge] = 0;
  style.top = CORNER_SIZE;
  style.bottom = CORNER_SIZE;
  return style;
};

export const WindowResizeBorder = () => {
  const needsCustomResizeBorder = IS_LINUX || IS_WINDOWS;

  if (!needsCustomResizeBorder) {
    return null;
  }

  return (
    <>
      {resizeZones.map((zone) => (
        <div
          key={zone.direction}
          aria-hidden="true"
          role="presentation"
          style={getResizeZoneStyle(zone)}
          onPointerDown={(event) => handleResizePointerDown(event, zone.direction)}
          onMouseDown={(event) => handleResizeMouseDown(event, zone.direction)}
          onDragStart={(event) => event.preventDefault()}
        />
      ))}
    </>
  );
};

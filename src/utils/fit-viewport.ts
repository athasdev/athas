export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportBounds {
  width: number;
  height: number;
}

export type Side = "top" | "bottom" | "left" | "right";

export interface AdjustmentOptions {
  margin: number;
  side?: Side;
}

const MARGIN = 8;

export function adjustPositionToFitViewport(
  el: ElementBounds,
  margin: number = MARGIN,
): { x: number; y: number } {
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  let adjustedX = el.x;
  let adjustedY = el.y;

  if (adjustedX + el.width > viewport.width - margin) {
    adjustedX = viewport.width - el.width - margin;
  }
  if (adjustedX < margin) {
    adjustedX = margin;
  }

  if (adjustedY + el.height > viewport.height - margin) {
    adjustedY = viewport.height - el.height - margin;
  }
  if (adjustedY < margin) {
    adjustedY = margin;
  }

  return { x: adjustedX, y: adjustedY };
}

export function calculateTooltipPosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  side: Side = "top",
): { x: number; y: number } {
  let x = triggerRect.left;
  let y = triggerRect.top;

  switch (side) {
    case "top":
      x += (triggerRect.width - tooltipRect.width) / 2;
      y -= tooltipRect.height + MARGIN;
      break;
    case "bottom":
      x += (triggerRect.width - tooltipRect.width) / 2;
      y += triggerRect.height + MARGIN;
      break;
    case "left":
      x -= tooltipRect.width + MARGIN;
      y += (triggerRect.height - tooltipRect.height) / 2;
      break;
    case "right":
      x += triggerRect.width + MARGIN;
      y += (triggerRect.height - tooltipRect.height) / 2;
      break;
  }

  const bounds = {
    x,
    y,
    width: tooltipRect.width,
    height: tooltipRect.height,
  };

  return adjustPositionToFitViewport(bounds);
}

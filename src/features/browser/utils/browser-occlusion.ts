const SAMPLE_STEPS = 5;
const SAMPLE_INSET_PX = 2;

/**
 * Elements that may sit over a browser tab without hiding it. Toasts come and go on their own, and
 * hiding the page every time one appears would flicker it; they stay under the page instead.
 */
const NON_OCCLUDING_SELECTOR = "[data-sonner-toaster]";

export interface BrowserSlotGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of the slot inside the window. A native webview can't be clipped by CSS, so a slot that
 * scrolled partly out of view shows only its visible part.
 */
export function getVisibleSlotGeometry(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  viewport: { width: number; height: number },
): BrowserSlotGeometry | null {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.right);
  const bottom = Math.min(viewport.height, rect.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/**
 * Whether workbench UI covers part of the slot. Native webviews always draw above the workbench,
 * so menus, dialogs and pickers over a browser tab would open invisibly underneath it; the tab
 * hides while any of them overlaps. Sampling hit tests finds every kind of overlay without the
 * slot having to know them.
 */
export function isSlotOccluded(slot: HTMLElement, geometry: BrowserSlotGeometry): boolean {
  for (let row = 0; row < SAMPLE_STEPS; row += 1) {
    for (let column = 0; column < SAMPLE_STEPS; column += 1) {
      const x =
        geometry.x +
        SAMPLE_INSET_PX +
        ((geometry.width - SAMPLE_INSET_PX * 2) * column) / (SAMPLE_STEPS - 1);
      const y =
        geometry.y +
        SAMPLE_INSET_PX +
        ((geometry.height - SAMPLE_INSET_PX * 2) * row) / (SAMPLE_STEPS - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || slot.contains(hit)) continue;
      if (hit.closest(NON_OCCLUDING_SELECTOR)) continue;
      return true;
    }
  }
  return false;
}

const SAMPLE_STEPS = 5;
/** Keeps hit tests clear of the slot's rounded corners, where they would land on its parent. */
const SAMPLE_INSET_PX = 16;

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

function intersects(rect: DOMRect, geometry: BrowserSlotGeometry) {
  return (
    rect.right > geometry.x &&
    rect.left < geometry.x + geometry.width &&
    rect.bottom > geometry.y &&
    rect.top < geometry.y + geometry.height
  );
}

/**
 * Whether a visible element under `root` overlaps the slot. Elements the pointer passes through,
 * such as tooltips and drag previews, don't count, and neither do ones still fading in.
 */
function hasOverlayOver(root: Element, geometry: BrowserSlotGeometry): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    const element = node as Element;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || !intersects(rect, geometry)) continue;
    if (element.closest(NON_OCCLUDING_SELECTOR)) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.pointerEvents === "none") continue;
    if (Number.parseFloat(style.opacity) === 0) continue;
    return true;
  }
  return false;
}

/**
 * Whether workbench UI covers part of the slot. Native webviews always draw above the workbench,
 * so menus, dialogs and pickers over a browser tab would open invisibly underneath it; the tab
 * hides while any of them overlaps.
 *
 * Popups render in portals next to the app root, so each portal's elements are checked against
 * the slot, which finds a small menu over a corner as reliably as a full-window dialog. Overlays
 * inside the app, such as split drop zones, are found by hit testing a grid over the slot.
 */
export function isSlotOccluded(slot: HTMLElement, geometry: BrowserSlotGeometry): boolean {
  for (const root of document.body.children) {
    if (root.contains(slot) || root instanceof HTMLScriptElement) continue;
    if (hasOverlayOver(root, geometry)) return true;
  }

  const inset = Math.min(SAMPLE_INSET_PX, geometry.width / 4, geometry.height / 4);
  for (let row = 0; row < SAMPLE_STEPS; row += 1) {
    for (let column = 0; column < SAMPLE_STEPS; column += 1) {
      const x = geometry.x + inset + ((geometry.width - inset * 2) * column) / (SAMPLE_STEPS - 1);
      const y = geometry.y + inset + ((geometry.height - inset * 2) * row) / (SAMPLE_STEPS - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || slot.contains(hit)) continue;
      if (hit.closest(NON_OCCLUDING_SELECTOR)) continue;
      return true;
    }
  }
  return false;
}

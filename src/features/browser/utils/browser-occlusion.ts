/**
 * Finds the workbench UI that paints over browser pages.
 *
 * A page is a native view drawn above the whole workbench webview, so CSS can't put a menu, a
 * toast or a dialog on top of it. Instead the workbench measures what would paint over each page
 * and the native layer cuts those areas out of the page (or hides it where that isn't possible),
 * which lets the workbench UI underneath show through.
 */

export interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * In-app elements, under the app root, that float over other content. Toasts render inside the
 * app root, and features can mark their own floating UI with `data-browser-occluder`.
 */
export const IN_APP_OVERLAY_SELECTOR = "[data-sonner-toaster], [data-browser-occluder]";

/** The most holes a page takes; beyond it the page gets one hole around all of them. */
const MAX_HOLES = 24;
/** The most elements one overlay walk visits, so a huge portal can't stall a frame. */
const MAX_VISITED_ELEMENTS = 600;
const SAMPLE_SPACING_PX = 32;
const MAX_SAMPLES_PER_AXIS = 16;
const SAMPLE_INSET_PX = 3;
const NON_RENDERED_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);
const REPLACED_TAGS = new Set([
  "IMG",
  "SVG",
  "CANVAS",
  "VIDEO",
  "IFRAME",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

/**
 * The part of the slot inside the window. A native webview can't be clipped by CSS, so a slot that
 * scrolled partly out of view shows only its visible part.
 */
export function getVisibleSlotGeometry(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  viewport: { width: number; height: number },
): BrowserRect | null {
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

export function intersectRects(a: BrowserRect, b: BrowserRect): BrowserRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function containsPoint(rect: BrowserRect, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** The parts of `base` outside every hole, as rectangles that don't overlap. */
export function subtractRects(base: BrowserRect, holes: readonly BrowserRect[]): BrowserRect[] {
  let pieces: BrowserRect[] = [base];
  for (const hole of holes) {
    const next: BrowserRect[] = [];
    for (const piece of pieces) {
      const cut = intersectRects(piece, hole);
      if (!cut) {
        next.push(piece);
        continue;
      }
      const pieceRight = piece.x + piece.width;
      const pieceBottom = piece.y + piece.height;
      const cutRight = cut.x + cut.width;
      const cutBottom = cut.y + cut.height;
      if (cut.y > piece.y) next.push({ ...piece, height: cut.y - piece.y });
      if (cutBottom < pieceBottom) {
        next.push({ ...piece, y: cutBottom, height: pieceBottom - cutBottom });
      }
      if (cut.x > piece.x) {
        next.push({ x: piece.x, y: cut.y, width: cut.x - piece.x, height: cut.height });
      }
      if (cutRight < pieceRight) {
        next.push({ x: cutRight, y: cut.y, width: pieceRight - cutRight, height: cut.height });
      }
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

/** Whether the holes leave nothing of `base` to show. */
export function isRectCovered(base: BrowserRect, holes: readonly BrowserRect[]): boolean {
  return holes.length > 0 && subtractRects(base, holes).length === 0;
}

function boundingRect(rects: readonly BrowserRect[]): BrowserRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The overlays that fall on a page placed at `geometry`, relative to the page's top left corner
 * and rounded outwards to whole pixels, so a hole never leaves a sliver of page over its overlay.
 */
export function getLocalHoles(
  geometry: BrowserRect,
  overlays: readonly BrowserRect[],
): BrowserRect[] {
  const holes: BrowserRect[] = [];
  const seen = new Set<string>();
  for (const overlay of overlays) {
    const cut = intersectRects(geometry, overlay);
    if (!cut) continue;
    const left = Math.max(0, Math.floor(cut.x - geometry.x));
    const top = Math.max(0, Math.floor(cut.y - geometry.y));
    const right = Math.min(geometry.width, Math.ceil(cut.x + cut.width - geometry.x));
    const bottom = Math.min(geometry.height, Math.ceil(cut.y + cut.height - geometry.y));
    if (right - left < 1 || bottom - top < 1) continue;
    const hole = { x: left, y: top, width: right - left, height: bottom - top };
    const key = rectsKey([hole]);
    if (seen.has(key)) continue;
    seen.add(key);
    holes.push(hole);
  }
  holes.sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height);
  return holes.length > MAX_HOLES ? [boundingRect(holes)] : holes;
}

export function rectsKey(rects: readonly BrowserRect[]): string {
  return rects.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join(";");
}

/**
 * Whether the slot is rendered at all; panes keep inactive surfaces mounted but invisible. Being
 * inert doesn't count, since modal popups make the rest of the app inert while it stays on screen.
 */
export function isSlotShown(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden]")) return false;
  const { visibility } = getComputedStyle(element);
  return visibility !== "hidden" && visibility !== "collapse";
}

function colorAlpha(color: string) {
  const value = color.trim();
  if (!value || value === "transparent") return 0;
  const slash = value.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return Number.parseFloat(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = value.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/);
  if (rgba) return Number.parseFloat(rgba[1]);
  return 1;
}

function hasOwnText(element: Element) {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
  }
  return false;
}

/** Whether the element itself draws something, as opposed to only positioning its children. */
function paints(element: Element, style: CSSStyleDeclaration) {
  if (REPLACED_TAGS.has(element.tagName.toUpperCase())) return true;
  if (colorAlpha(style.backgroundColor) > 0) return true;
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  if (style.boxShadow && style.boxShadow !== "none") return true;
  if (style.backdropFilter && style.backdropFilter !== "none") return true;
  const border =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderRightWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0) +
    (Number.parseFloat(style.borderLeftWidth) || 0);
  if (border > 0 && style.borderStyle !== "none" && colorAlpha(style.borderColor) > 0) return true;
  return hasOwnText(element);
}

/**
 * Whether a transparent element is on its way in or out. A popup about to fade in counts from its
 * first frame, so the page makes room before the popup shows, and keeps counting until it is gone.
 */
function isFading(element: Element) {
  if (element.hasAttribute("data-starting-style") || element.hasAttribute("data-ending-style")) {
    return true;
  }
  return typeof element.getAnimations === "function" && element.getAnimations().length > 0;
}

/**
 * The boxes `root` draws. Wrappers that only position their children, such as a popup's
 * positioner or a full-window container of toasts, are looked through, so they don't turn into a
 * hole over the whole page. An element that draws is taken whole, children included.
 */
export function collectPaintedRects(root: Element, into: BrowserRect[] = []): BrowserRect[] {
  const stack: Element[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_VISITED_ELEMENTS) {
    const element = stack.pop() as Element;
    visited += 1;
    if (NON_RENDERED_TAGS.has(element.tagName.toUpperCase())) continue;
    const style = getComputedStyle(element);
    if (style.display === "none") continue;
    if (style.visibility === "hidden" || style.visibility === "collapse") continue;
    if (Number.parseFloat(style.opacity) === 0 && !isFading(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1 && paints(element, style)) {
      into.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      continue;
    }
    const children = element.shadowRoot ? element.shadowRoot.children : element.children;
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return into;
}

function intersectsGeometry(rect: DOMRect, geometry: BrowserRect) {
  return (
    rect.right > geometry.x &&
    rect.left < geometry.x + geometry.width &&
    rect.bottom > geometry.y &&
    rect.top < geometry.y + geometry.height
  );
}

/**
 * The element that floats over the slot at a hit point: the outermost ancestor of `hit` that is
 * still over the slot but doesn't hold it, such as a column of floating cards in a session.
 */
function findCoveringLayer(hit: Element, slot: HTMLElement, geometry: BrowserRect) {
  let layer = hit;
  for (let parent = hit.parentElement; parent; parent = parent.parentElement) {
    if (parent.contains(slot)) break;
    if (!intersectsGeometry(parent.getBoundingClientRect(), geometry)) break;
    layer = parent;
  }
  return layer;
}

/**
 * Elements inside the app that cover part of a slot, found by hit testing a grid over it. Popups
 * in portals are found without this; it catches app UI that floats over a page in place.
 */
export function sampleCoveringLayers(
  slot: HTMLElement,
  geometry: BrowserRect,
  known: readonly BrowserRect[],
  into: Set<Element>,
) {
  const columns = Math.min(
    MAX_SAMPLES_PER_AXIS,
    Math.max(3, Math.ceil(geometry.width / SAMPLE_SPACING_PX)),
  );
  const rows = Math.min(
    MAX_SAMPLES_PER_AXIS,
    Math.max(3, Math.ceil(geometry.height / SAMPLE_SPACING_PX)),
  );
  const inset = Math.min(SAMPLE_INSET_PX, geometry.width / 4, geometry.height / 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = geometry.x + inset + ((geometry.width - inset * 2) * column) / (columns - 1);
      const y = geometry.y + inset + ((geometry.height - inset * 2) * row) / (rows - 1);
      if (known.some((rect) => containsPoint(rect, x, y))) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || slot.contains(hit) || hit.contains(slot)) continue;
      into.add(findCoveringLayer(hit, slot, geometry));
    }
  }
}

export interface OverlayScan {
  rects: BrowserRect[];
  /** In-app layers found by hit testing, measured again on frames that skip the hit test. */
  layers: Set<Element>;
}

/**
 * Everything that paints over the given slots, in window coordinates. Portals next to the app
 * root (menus, popovers, tooltips, dialogs, the command palette) and in-app overlays such as
 * toasts are walked on every call; hit testing for other in-app UI runs only when `sample` is set
 * and otherwise re-measures the layers an earlier call found.
 */
export function scanOverlays(
  slots: readonly { element: HTMLElement; geometry: BrowserRect }[],
  sample: boolean,
  previousLayers: ReadonlySet<Element> = new Set(),
): OverlayScan {
  const rects: BrowserRect[] = [];
  const holdsSlot = (element: Element) => slots.some((slot) => element.contains(slot.element));

  for (const root of document.body.children) {
    if (holdsSlot(root)) continue;
    collectPaintedRects(root, rects);
  }
  for (const host of document.querySelectorAll(IN_APP_OVERLAY_SELECTOR)) {
    if (holdsSlot(host) || !document.body.contains(host)) continue;
    collectPaintedRects(host, rects);
  }

  const layers = new Set<Element>();
  if (sample) {
    for (const slot of slots) sampleCoveringLayers(slot.element, slot.geometry, rects, layers);
  } else {
    for (const layer of previousLayers) {
      if (layer.isConnected && !holdsSlot(layer)) layers.add(layer);
    }
  }
  for (const layer of layers) collectPaintedRects(layer, rects);
  return { rects, layers };
}

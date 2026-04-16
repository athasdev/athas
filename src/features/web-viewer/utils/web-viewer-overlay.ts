function rectsOverlap(a: DOMRect, b: DOMRect) {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

function isVisibleOverlay(element: Element) {
  if (!(element instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    element.getAttribute("aria-hidden") !== "true"
  );
}

export function hasOverlayCoveringWebview(container: HTMLElement | null) {
  if (!container) return false;

  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return false;

  const dialog = document.querySelector('[role="dialog"][data-state="open"]');
  if (dialog && isVisibleOverlay(dialog)) {
    return true;
  }

  const overlays = document.querySelectorAll('[role="menu"], .context-menu');
  for (const overlay of overlays) {
    if (!isVisibleOverlay(overlay)) continue;
    if (rectsOverlap(overlay.getBoundingClientRect(), containerRect)) {
      return true;
    }
  }

  return false;
}

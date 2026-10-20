interface Point {
  x: number;
  y: number;
}

interface KeyboardInvocation {
  from: Point;
  to: Point;
  at: number;
}

/** How long after a keyboard invocation a menu opening at its point still counts as from it. */
const INVOCATION_WINDOW_MS = 1000;

let lastKeyboardInvocation: KeyboardInvocation | null = null;

/**
 * Shift+F10, the context-menu key and Enter on a button fire their events without a pointer, so
 * their coordinates say nothing useful (often the window's corner).
 */
function isKeyboardInvoked(event: MouseEvent) {
  if (event.type === "click")
    return event.detail === 0 && event.clientX === 0 && event.clientY === 0;
  if ("pointerType" in event && (event as PointerEvent).pointerType === "") return true;
  return event.clientX === 0 && event.clientY === 0;
}

function recordInvocation(event: MouseEvent) {
  if (!isKeyboardInvoked(event) || !(event.target instanceof Element)) return;
  const rect = event.target.getBoundingClientRect();
  lastKeyboardInvocation = {
    from: { x: event.clientX, y: event.clientY },
    to: { x: Math.round(rect.left), y: Math.round(rect.bottom) },
    at: performance.now(),
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", recordInvocation, true);
  document.addEventListener("click", recordInvocation, true);
}

/**
 * Where a menu requested at `point` should open. A menu opened from the keyboard takes the
 * focused element's bottom left corner instead of the event's meaningless coordinates.
 */
export function resolveMenuPoint(point: Point): Point {
  const invocation = lastKeyboardInvocation;
  if (
    invocation &&
    performance.now() - invocation.at < INVOCATION_WINDOW_MS &&
    invocation.from.x === point.x &&
    invocation.from.y === point.y
  ) {
    return invocation.to;
  }
  return point;
}

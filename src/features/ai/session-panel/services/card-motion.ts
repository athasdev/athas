export interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const origins = new Map<string, CardRect>();

/** Remembers the box row a session's tool card grows from, until the card reads it. */
export function setCardOrigin(chatId: string, rect: CardRect) {
  origins.set(chatId, rect);
}

export function takeCardOrigin(chatId: string): CardRect | null {
  const rect = origins.get(chatId) ?? null;
  origins.delete(chatId);
  return rect;
}

/**
 * The transform that draws an element laid out at `to` where `from` is, with its origin at the
 * top left: the first frame of a grow from a box row, or the last frame of a collapse into one.
 */
export function getFlipTransform(from: CardRect, to: CardRect): string {
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  const x = from.left - to.left;
  const y = from.top - to.top;
  return `translate(${round(x)}px, ${round(y)}px) scale(${round(scaleX, 4)}, ${round(scaleY, 4)})`;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The app's `duration-normal` and `ease-smooth`, read from the theme. */
function readMotionTokens() {
  const style = getComputedStyle(document.documentElement);
  const duration = Number.parseFloat(style.getPropertyValue("--app-duration-normal")) || 200;
  const easing = style.getPropertyValue("--app-ease-smooth").trim() || "ease-out";
  return { duration, easing };
}

/**
 * Moves `element` between `from` and where it is laid out now. Returns a promise that settles
 * when the motion ends, at once when the user prefers reduced motion or the element can't animate.
 */
export function animateCard(
  element: HTMLElement,
  from: CardRect | null,
  direction: "in" | "out",
): Promise<void> {
  if (prefersReducedMotion() || typeof element.animate !== "function") return Promise.resolve();
  const to = element.getBoundingClientRect();
  const start = from
    ? { transform: getFlipTransform(from, to), opacity: 0.6 }
    : { transform: "scale(0.98)", opacity: 0 };
  const end = { transform: "none", opacity: 1 };
  const { duration, easing } = readMotionTokens();
  const animation = element.animate(direction === "in" ? [start, end] : [end, start], {
    duration,
    easing,
    fill: direction === "out" ? "forwards" : "none",
  });
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

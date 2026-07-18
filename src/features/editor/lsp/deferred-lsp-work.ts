export function deferUntilAfterNextPaint(callback: () => void): () => void {
  let cancelled = false;
  let firstFrameId: number | undefined;
  let secondFrameId: number | undefined;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  const run = () => {
    timeoutId = globalThis.setTimeout(() => {
      if (!cancelled) {
        callback();
      }
    }, 0);
  };

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(run);
    });
  } else {
    run();
  }

  return () => {
    cancelled = true;
    if (firstFrameId !== undefined) {
      window.cancelAnimationFrame(firstFrameId);
    }
    if (secondFrameId !== undefined) {
      window.cancelAnimationFrame(secondFrameId);
    }
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  };
}

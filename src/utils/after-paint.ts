/**
 * Runs `callback` once the browser has painted the current frame: an animation frame runs just
 * before that paint, and a task queued from it runs after. Returns a function that cancels it.
 */
export function runAfterNextPaint(callback: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(callback, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timeout !== undefined) clearTimeout(timeout);
  };
}

/** Whole seconds from `since` to `now`, never negative. */
export function elapsedSeconds(since: Date | string, now: number): number {
  const start = new Date(since).getTime();
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
}

/** A short running time such as "8s" or "2m 05s". */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

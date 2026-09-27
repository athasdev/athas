export type CrashReportBuild = "dev" | "release";

export function crashReportBuild(isDev: boolean): CrashReportBuild {
  return isDev ? "dev" : "release";
}

export function isExpectedCancellation(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === "Canceled" ||
      error.name === "CancellationError" ||
      error.message === "Canceled" ||
      error.message === "Canceled: Canceled"
    );
  }

  return error === "Canceled" || error === "Canceled: Canceled";
}

/**
 * Browser engines report a ResizeObserver callback that resizes its own target as a
 * window error. The observer simply runs again on the next frame, so nothing is lost.
 */
const BENIGN_WINDOW_ERROR_PATTERNS = [
  /^ResizeObserver loop completed with undelivered notifications\.?$/,
  /^ResizeObserver loop limit exceeded$/,
];

export function isBenignWindowError(message: string | null | undefined): boolean {
  const normalized = (message ?? "").replace(/^Uncaught (?:Error: )?/, "").trim();
  return BENIGN_WINDOW_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

const CLOSE_TAB_CLOSE_REQUEST_WINDOW_MS = 1000;

let lastCloseTabShortcutAt: number | null = null;

export function markCloseTabShortcutHandled(at = Date.now()) {
  lastCloseTabShortcutAt = at;
}

export function consumeCloseRequestSuppression(at = Date.now()) {
  const elapsed = lastCloseTabShortcutAt === null ? null : at - lastCloseTabShortcutAt;
  const shouldSuppress =
    elapsed !== null && elapsed >= 0 && elapsed <= CLOSE_TAB_CLOSE_REQUEST_WINDOW_MS;

  lastCloseTabShortcutAt = null;
  return shouldSuppress;
}

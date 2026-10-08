import type { GitChange } from "../events/git-events";

const SAVE_SOURCES = new Set(["save", "auto-save"]);

export interface GitStatusRefreshSchedulerOptions {
  /** Trailing delay for any change other than our own saves. */
  delayMs?: number;
  /** Trailing delay for our own saves: autosave can save about once a second while typing. */
  saveDelayMs?: number;
  /** Longest a burst of saves can hold the refresh back. */
  saveMaxWaitMs?: number;
}

export interface GitStatusRefreshScheduler {
  schedule: (change: GitChange) => void;
  dispose: () => void;
}

/**
 * Coalesces git status refreshes. Our own saves wait longer than other changes, and a refresh
 * already scheduled for another change covers any save that lands before it runs.
 */
export function createGitStatusRefreshScheduler(
  refresh: () => void,
  {
    delayMs = 300,
    saveDelayMs = 1500,
    saveMaxWaitMs = 5000,
  }: GitStatusRefreshSchedulerOptions = {},
): GitStatusRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingForSave = false;
  let saveBurstStartedAt = 0;

  const arm = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pendingForSave = false;
      refresh();
    }, delay);
  };

  return {
    schedule: (change) => {
      if (!change.source || !SAVE_SOURCES.has(change.source)) {
        pendingForSave = false;
        arm(delayMs);
        return;
      }
      if (timer && !pendingForSave) return;

      const now = Date.now();
      if (!timer) saveBurstStartedAt = now;
      pendingForSave = true;
      arm(Math.max(0, Math.min(saveDelayMs, saveBurstStartedAt + saveMaxWaitMs - now)));
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingForSave = false;
    },
  };
}

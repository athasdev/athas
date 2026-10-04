export interface WorkspaceSessionSaveQueue<T> {
  schedule: (projectPath: string, payload: T) => void;
  clear: (projectPath: string) => void;
  flush: (projectPath?: string) => void;
}

export function createWorkspaceSessionSaveQueue<T>(
  save: (projectPath: string, payload: T) => void,
  delayMs: number,
): WorkspaceSessionSaveQueue<T> {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, T>();
  const deadlines = new Map<string, number>();
  const maxWaitMs = Math.max(delayMs * 10, 1000);
  const flush = (projectPath: string) => {
    const timer = timers.get(projectPath);
    if (timer) clearTimeout(timer);
    timers.delete(projectPath);
    deadlines.delete(projectPath);
    if (!pending.has(projectPath)) return;
    const payload = pending.get(projectPath) as T;
    pending.delete(projectPath);
    try {
      save(projectPath, payload);
    } catch (error) {
      if (!pending.has(projectPath)) pending.set(projectPath, payload);
      throw error;
    }
  };

  return {
    schedule(projectPath, payload) {
      pending.set(projectPath, payload);
      const deadline = deadlines.get(projectPath) ?? Date.now() + maxWaitMs;
      deadlines.set(projectPath, deadline);

      const existingTimer = timers.get(projectPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(
        () => flush(projectPath),
        Math.max(0, Math.min(delayMs, deadline - Date.now())),
      );

      timers.set(projectPath, timer);
    },

    flush(projectPath) {
      if (projectPath !== undefined) flush(projectPath);
      else {
        const pathsToFlush = Array.from(pending.keys());
        for (const path of pathsToFlush) flush(path);
      }
    },

    clear(projectPath) {
      const existingTimer = timers.get(projectPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.delete(projectPath);
      }

      pending.delete(projectPath);
      deadlines.delete(projectPath);
    },
  };
}

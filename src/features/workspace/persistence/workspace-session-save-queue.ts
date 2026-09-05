export interface WorkspaceSessionSaveQueue<T> {
  schedule: (projectPath: string, payload: T) => void;
  clear: (projectPath: string) => void;
}

export function createWorkspaceSessionSaveQueue<T>(
  save: (projectPath: string, payload: T) => void,
  delayMs: number,
): WorkspaceSessionSaveQueue<T> {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, T>();
  const deadlines = new Map<string, number>();
  const maxWaitMs = Math.max(delayMs * 10, 1000);

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
        () => {
          timers.delete(projectPath);
          deadlines.delete(projectPath);
          if (!pending.has(projectPath)) {
            return;
          }

          const latestPayload = pending.get(projectPath) as T;
          pending.delete(projectPath);
          save(projectPath, latestPayload);
        },
        Math.max(0, Math.min(delayMs, deadline - Date.now())),
      );

      timers.set(projectPath, timer);
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

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

  return {
    schedule(projectPath, payload) {
      pending.set(projectPath, payload);

      const existingTimer = timers.get(projectPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        timers.delete(projectPath);
        const latestPayload = pending.get(projectPath);
        if (!latestPayload) {
          return;
        }

        pending.delete(projectPath);
        save(projectPath, latestPayload);
      }, delayMs);

      timers.set(projectPath, timer);
    },

    clear(projectPath) {
      const existingTimer = timers.get(projectPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.delete(projectPath);
      }

      pending.delete(projectPath);
    },
  };
}

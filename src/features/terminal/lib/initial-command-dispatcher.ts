type TimerHandle = ReturnType<typeof setTimeout>;

interface DispatcherDependencies {
  fallbackDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

interface PendingCommand {
  command: string;
  send: (data: string) => void;
  timer: TimerHandle;
}

interface ArmCommandOptions {
  connectionId: string;
  command: string;
  send: (data: string) => void;
}

export function createInitialCommandDispatcher({
  fallbackDelayMs = 1500,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (handle) => clearTimeout(handle),
}: DispatcherDependencies = {}) {
  const pendingCommands = new Map<string, PendingCommand>();

  const sendNow = (connectionId: string) => {
    const pending = pendingCommands.get(connectionId);
    if (!pending) return;

    cancel(pending.timer);
    pendingCommands.delete(connectionId);
    pending.send(`${pending.command}\n`);
  };

  return {
    arm({ connectionId, command, send }: ArmCommandOptions) {
      if (!command) return;

      const existing = pendingCommands.get(connectionId);
      if (existing) {
        cancel(existing.timer);
      }

      const timer = schedule(() => {
        sendNow(connectionId);
      }, fallbackDelayMs);

      pendingCommands.set(connectionId, {
        command,
        send,
        timer,
      });
    },

    notifyOutput(connectionId: string) {
      sendNow(connectionId);
    },

    disarm(connectionId: string) {
      const pending = pendingCommands.get(connectionId);
      if (!pending) return;

      cancel(pending.timer);
      pendingCommands.delete(connectionId);
    },
  };
}

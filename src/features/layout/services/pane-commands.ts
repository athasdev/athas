/**
 * What a mounted pane can be asked to do, by name. A dock pane (or any other view) registers its
 * commands while it is mounted, so a command palette entry can open the pane and then hand it the
 * action once the pane is ready, instead of guessing with a timer.
 */
export type PaneCommands = Record<string, (argument: never) => void>;

/** How long a command waits for its pane to mount before giving up. */
const DEFAULT_READY_TIMEOUT_MS = 5000;

const registered = new Map<string, PaneCommands>();
const waiters = new Map<string, Set<(commands: PaneCommands) => void>>();

/** Makes `key`'s commands available until the returned function is called. */
export function registerPaneCommands(key: string, commands: PaneCommands): () => void {
  registered.set(key, commands);
  const pending = waiters.get(key);
  if (pending) {
    waiters.delete(key);
    for (const resolve of pending) resolve(commands);
  }
  return () => {
    if (registered.get(key) === commands) registered.delete(key);
  };
}

/** The commands of the pane `key` once it is mounted, or null when it does not mount in time. */
export function whenPaneReady(
  key: string,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
): Promise<PaneCommands | null> {
  const commands = registered.get(key);
  if (commands) return Promise.resolve(commands);
  return new Promise((resolve) => {
    const pending = waiters.get(key) ?? new Set();
    waiters.set(key, pending);
    const settle = (value: PaneCommands | null) => {
      clearTimeout(timer);
      pending.delete(settle);
      if (pending.size === 0 && waiters.get(key) === pending) waiters.delete(key);
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    pending.add(settle);
  });
}

/** Whether the pane `key` is mounted now. */
export function isPaneReady(key: string): boolean {
  return registered.has(key);
}

/**
 * Runs `name` on the pane `key`, waiting for the pane to mount first. Resolves whether it ran:
 * false when the pane never mounted or does not know the command.
 */
export async function runPaneCommand(
  key: string,
  name: string,
  argument?: unknown,
  timeoutMs?: number,
): Promise<boolean> {
  const commands = await whenPaneReady(key, timeoutMs);
  const command = commands?.[name] as ((value?: unknown) => void) | undefined;
  if (!command) return false;
  command(argument);
  return true;
}

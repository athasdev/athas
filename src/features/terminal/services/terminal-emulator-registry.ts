import type { TerminalEmulatorHandle } from "../types/terminal.types";

/**
 * Live terminal frontends keyed by session id. Kept outside zustand on purpose: the handles wrap
 * xterm instances, which must never be stored in reactive state. Every mounted TerminalEmulator
 * registers here, including tabs that are not shown in the bottom pane right now.
 */
const emulators = new Map<string, TerminalEmulatorHandle>();

export function registerTerminalEmulator(
  sessionId: string,
  handle: TerminalEmulatorHandle,
): () => void {
  emulators.set(sessionId, handle);
  return () => {
    if (emulators.get(sessionId) === handle) emulators.delete(sessionId);
  };
}

export function getTerminalEmulator(sessionId: string): TerminalEmulatorHandle | undefined {
  return emulators.get(sessionId);
}

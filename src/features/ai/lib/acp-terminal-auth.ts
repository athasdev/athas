import type { AcpTerminalAuthLaunch } from "@/features/ai/types/acp.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { TERMINAL_PROCESS_EXIT_EVENT } from "@/features/terminal/constants/terminal-events";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";

export interface AcpTerminalAuthExit {
  exitCode: number | null;
  signal: string | null;
  /** The user closed the sign-in tab before the command exited. */
  tabClosed?: boolean;
}

/**
 * Runs an agent's terminal sign-in in a new Athas terminal tab, where the user completes it.
 * The command runs directly, not through the shell, so its exit status is the sign-in result.
 * Resolves when it exits or its tab is closed first, or with null when `signal` aborts the wait.
 */
export function runAcpTerminalAuth(
  launch: AcpTerminalAuthLaunch,
  options: { workingDirectory?: string; signal?: AbortSignal } = {},
): Promise<AcpTerminalAuthExit | null> {
  const sessionId = `acp-auth-${crypto.randomUUID()}`;

  return new Promise((resolve) => {
    let tabOpened = false;
    let stopWatchingTab = () => {};
    const finish = (result: AcpTerminalAuthExit | null) => {
      stopWatchingTab();
      window.removeEventListener(TERMINAL_PROCESS_EXIT_EVENT, handleExit);
      options.signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleExit = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string } & AcpTerminalAuthExit>).detail;
      if (detail?.sessionId !== sessionId) return;
      finish({ exitCode: detail.exitCode, signal: detail.signal });
    };
    const handleAbort = () => finish(null);

    if (options.signal?.aborted) {
      resolve(null);
      return;
    }
    window.addEventListener(TERMINAL_PROCESS_EXIT_EVENT, handleExit);
    options.signal?.addEventListener("abort", handleAbort);

    useTerminalStore.getState().actions.updateSession(sessionId, {
      launch: { command: launch.command, args: launch.args, environment: launch.env },
    });
    // Closing the tab ends the command without an exit event, so the wait would never end.
    const hasTab = () =>
      useBufferStore
        .getState()
        .buffers.some((buffer) => buffer.type === "terminal" && buffer.sessionId === sessionId);
    stopWatchingTab = useBufferStore.subscribe(() => {
      if (hasTab()) tabOpened = true;
      else if (tabOpened) finish({ exitCode: null, signal: null, tabClosed: true });
    });
    useBufferStore.getState().actions.openTerminalBuffer({
      sessionId,
      name: launch.label,
      workingDirectory: options.workingDirectory,
    });
    if (hasTab()) tabOpened = true;
  });
}

export function describeAcpTerminalAuthFailure(exit: AcpTerminalAuthExit): string {
  if (exit.tabClosed) return "The sign-in tab was closed before signing in finished.";
  if (exit.signal) return `The sign-in command was stopped (${exit.signal}).`;
  if (exit.exitCode === null) return "The sign-in command ended without an exit status.";
  return `The sign-in command exited with code ${exit.exitCode}.`;
}

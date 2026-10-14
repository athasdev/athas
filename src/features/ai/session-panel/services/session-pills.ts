import { isLongRunningCommand } from "@/features/ai/lib/shell-command";
import type { SessionPanelTab } from "../types/session-panel.types";

/** How long a command shows a spinner before it counts as a process that keeps running. */
export const SHORT_COMMAND_MS = 4000;

export type SessionPill =
  | { id: "changes"; tab: "changes"; files: number; additions: number; deletions: number }
  /** A server that answers, with the command running it when that is known. */
  | { id: "browser"; tab: "browser"; url: string; command: string | null }
  | {
      id: "terminal";
      tab: SessionPanelTab;
      /** `running`: a short command in its first moments; `live`: a process that keeps running. */
      state: "failed" | "running" | "live";
      command: string | null;
    }
  | { id: "plan"; tab: "plan"; done: number; total: number };

export interface SessionPillSignals {
  panelOpen: boolean;
  changes: { files: number; additions: number; deletions: number };
  liveServer: string | null;
  /** A command failed in the session's own terminal. */
  terminalFailed: boolean;
  /** The agent's newest command still running, and when it started. */
  runningCommand: { command: string; startedAt: number } | null;
  plan: { done: number; total: number } | null;
  now: number;
}

/** Whether a running command is a process that keeps running rather than one being waited on. */
export function isLiveProcess(command: { command: string; startedAt: number }, now: number) {
  return now - command.startedAt >= SHORT_COMMAND_MS || isLongRunningCommand(command.command);
}

/**
 * The signals a session shows as pills while its tool card is collapsed, in tool order. Each
 * appears only while its signal exists, and none show while the card is expanded, since its
 * switcher carries the same marks.
 *
 * A running command shows a spinner only in its first moments; a dev server or watcher, or a
 * command that kept running, reads as live instead, and joins the Browser pill once its server
 * answers, so one process is one pill.
 */
export function getSessionPills(signals: SessionPillSignals): SessionPill[] {
  if (signals.panelOpen) return [];
  const pills: SessionPill[] = [];
  const { files, additions, deletions } = signals.changes;
  if (files > 0 && additions + deletions > 0) {
    pills.push({ id: "changes", tab: "changes", files, additions, deletions });
  }

  const running = signals.runningCommand;
  const live = running ? isLiveProcess(running, signals.now) : false;
  if (signals.liveServer) {
    pills.push({
      id: "browser",
      tab: "browser",
      url: signals.liveServer,
      command: running && live ? running.command : null,
    });
  }

  if (signals.terminalFailed) {
    pills.push({ id: "terminal", tab: "terminal", state: "failed", command: null });
  } else if (running && !(live && signals.liveServer)) {
    pills.push({
      id: "terminal",
      tab: "terminal",
      state: live ? "live" : "running",
      command: running.command,
    });
  }

  if (signals.plan && signals.plan.total > 0) {
    pills.push({ id: "plan", tab: "plan", ...signals.plan });
  }
  return pills;
}

/** The chat column is at most this wide (`max-w-4xl`), in rem. */
const CHAT_COLUMN_REM = 56;
/** Room a floating pill needs beside the chat column (`max-w-56` plus its margin), in rem. */
const FLOATING_PILL_REM = 15;

/**
 * Whether pills fit in the gutter beside the centred chat column. Narrower sessions show them in
 * the header instead, so they never cover the conversation or the composer.
 */
export function canFloatSessionPills(sessionWidth: number, remPx: number): boolean {
  const column = Math.min(sessionWidth - remPx, CHAT_COLUMN_REM * remPx);
  return (sessionWidth - column) / 2 >= FLOATING_PILL_REM * remPx;
}

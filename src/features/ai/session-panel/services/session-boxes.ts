import { isLongRunningCommand } from "@/features/ai/lib/shell-command";
import type { SessionBoxId } from "../types/session-panel.types";

/** How long a command shows a spinner before it counts as a process that keeps running. */
export const SHORT_COMMAND_MS = 4000;

export const SESSION_BOX_ORDER: SessionBoxId[] = [
  "environment",
  "context",
  "changes",
  "running",
  "cost",
  "plan",
  "connectors",
];

export type SessionRunningItem =
  /** A server that answers, with the command running it when that is known. */
  | { kind: "server"; url: string; command: string | null }
  /** `running`: a short command in its first moments; `live`: a process that keeps running. */
  | { kind: "command"; state: "running" | "live"; command: string }
  | { kind: "failed" };

export interface SessionRunningSignals {
  liveServer: string | null;
  /** A command failed in the session's own terminal. */
  terminalFailed: boolean;
  /** The agent's newest command still running, and when it started. */
  runningCommand: { command: string; startedAt: number } | null;
  now: number;
}

/** Whether a running command is a process that keeps running rather than one being waited on. */
export function isLiveProcess(command: { command: string; startedAt: number }, now: number) {
  return now - command.startedAt >= SHORT_COMMAND_MS || isLongRunningCommand(command.command);
}

/**
 * What the session has running: a server that answers, the agent's command still going, and a
 * command that failed in the session terminal. A dev server and the command that started it are
 * one process, so they make one row.
 */
export function getSessionRunningItems(signals: SessionRunningSignals): SessionRunningItem[] {
  const items: SessionRunningItem[] = [];
  const running = signals.runningCommand;
  const live = running ? isLiveProcess(running, signals.now) : false;
  if (signals.liveServer) {
    items.push({
      kind: "server",
      url: signals.liveServer,
      command: running && live ? running.command : null,
    });
  }
  if (running && !(live && signals.liveServer)) {
    items.push({ kind: "command", state: live ? "live" : "running", command: running.command });
  }
  if (signals.terminalFailed) items.push({ kind: "failed" });
  return items;
}

export interface SessionBoxSignals {
  /** The session has sent its first message. */
  started: boolean;
  hasContextUsage: boolean;
  runningItems: number;
  hasPlan: boolean;
  connectors: number;
  /** A cloud session's run: its sandbox runs remotely and it spends credit, not local context. */
  cloud?: { running: boolean; hasRun: boolean } | null;
}

/**
 * The boxes a session shows, in stacking order. Environment and Changes are there once the session
 * starts, so the column reads the same in every session; the others appear once they have
 * something to say.
 */
export function getVisibleSessionBoxes(signals: SessionBoxSignals): SessionBoxId[] {
  const cloud = signals.cloud;
  return SESSION_BOX_ORDER.filter((box) => {
    switch (box) {
      case "environment":
      case "changes":
        return signals.started;
      case "context":
        return !cloud && signals.hasContextUsage;
      case "running":
        return cloud ? cloud.running : signals.runningItems > 0;
      case "cost":
        return Boolean(cloud?.hasRun);
      case "plan":
        return signals.hasPlan;
      case "connectors":
        return !cloud && signals.connectors > 0;
    }
  });
}

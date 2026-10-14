import { isLongRunningCommand } from "@/features/ai/lib/shell-command";
import type { SessionBoxId, SessionPanelTab } from "../types/session-panel.types";

/** How long a command shows a spinner before it counts as a process that keeps running. */
export const SHORT_COMMAND_MS = 4000;

/** Below this session width, in rem, the boxes fold into a rail of their icons. */
export const BOX_COLUMN_MIN_REM = 60;
/** Below this session width, in rem, an open tool covers the conversation instead of sitting beside it. */
export const TOOL_SPLIT_MIN_REM = 40;

export const SESSION_BOX_ORDER: SessionBoxId[] = [
  "environment",
  "context",
  "changes",
  "running",
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
  hasContextUsage: boolean;
  runningItems: number;
  hasPlan: boolean;
  connectors: number;
}

/**
 * The boxes a session shows, in stacking order. Environment and Changes are always there, so the
 * column reads the same in every session; the others appear once they have something to say.
 */
export function getVisibleSessionBoxes(signals: SessionBoxSignals): SessionBoxId[] {
  return SESSION_BOX_ORDER.filter((box) => {
    switch (box) {
      case "environment":
      case "changes":
        return true;
      case "context":
        return signals.hasContextUsage;
      case "running":
        return signals.runningItems > 0;
      case "plan":
        return signals.hasPlan;
      case "connectors":
        return signals.connectors > 0;
    }
  });
}

/** The tools the panel switches between; Plan only while the session has one. */
export function getSessionToolTabs(hasPlan: boolean): SessionPanelTab[] {
  return hasPlan ? ["changes", "browser", "terminal", "plan"] : ["changes", "browser", "terminal"];
}

export interface SessionAsideLayout {
  /** `column`: the boxes stacked beside the chat; `rail`: their icons, each opening its box. */
  boxes: "column" | "rail" | "hidden";
  /** `split`: the tool sits between the chat and the rail; `cover`: it covers the chat. */
  tool: "none" | "split" | "cover";
}

/**
 * How a session lays out its boxes and its open tool. An open tool needs the room the column
 * took, so the column folds into its rail and every box stays one click away; closing the tool
 * unfolds it again. A session too narrow for the column keeps the rail, and one too narrow to
 * split lets the tool cover the conversation.
 */
export function getSessionAsideLayout({
  width,
  remPx,
  toolOpen,
  fullscreen,
  boxesHidden,
}: {
  width: number;
  remPx: number;
  toolOpen: boolean;
  fullscreen: boolean;
  boxesHidden: boolean;
}): SessionAsideLayout {
  const rem = width / (remPx || 16);
  if (toolOpen) {
    return {
      boxes: boxesHidden ? "hidden" : "rail",
      tool: fullscreen || rem < TOOL_SPLIT_MIN_REM ? "cover" : "split",
    };
  }
  if (boxesHidden) return { boxes: "hidden", tool: "none" };
  return { boxes: rem >= BOX_COLUMN_MIN_REM ? "column" : "rail", tool: "none" };
}

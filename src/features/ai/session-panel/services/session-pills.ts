import type { SessionPanelTab } from "../types/session-panel.types";

export type SessionPill =
  | { id: "changes"; tab: "changes"; files: number; additions: number; deletions: number }
  | { id: "browser"; tab: "browser"; url: string }
  | { id: "terminal"; tab: SessionPanelTab; state: "failed" | "running"; command: string | null }
  | { id: "plan"; tab: "plan"; done: number; total: number };

export interface SessionPillSignals {
  panelOpen: boolean;
  changes: { files: number; additions: number; deletions: number };
  liveServer: string | null;
  /** A command failed in the session's own terminal. */
  terminalFailed: boolean;
  /** A command the agent ran failed. */
  agentCommandFailed: boolean;
  runningCommand: string | null;
  plan: { done: number; total: number } | null;
}

/**
 * The signals a session shows as pills while its tool card is collapsed, in tool order. Each
 * appears only while its signal exists, and none show while the card is expanded, since its
 * switcher carries the same marks. A failure in the session terminal opens Terminal; the agent's own commands are listed
 * under Activity, so a failure or a running command there opens Activity.
 */
export function getSessionPills(signals: SessionPillSignals): SessionPill[] {
  if (signals.panelOpen) return [];
  const pills: SessionPill[] = [];
  const { files, additions, deletions } = signals.changes;
  if (files > 0 && additions + deletions > 0) {
    pills.push({ id: "changes", tab: "changes", files, additions, deletions });
  }
  if (signals.liveServer) pills.push({ id: "browser", tab: "browser", url: signals.liveServer });
  if (signals.terminalFailed) {
    pills.push({ id: "terminal", tab: "terminal", state: "failed", command: null });
  } else if (signals.agentCommandFailed) {
    pills.push({ id: "terminal", tab: "activity", state: "failed", command: null });
  } else if (signals.runningCommand) {
    pills.push({
      id: "terminal",
      tab: "activity",
      state: "running",
      command: signals.runningCommand,
    });
  }
  if (signals.plan && signals.plan.total > 0) {
    pills.push({ id: "plan", tab: "plan", ...signals.plan });
  }
  return pills;
}

/** The chat column is at most this wide (`max-w-4xl`), in rem. */
const CHAT_COLUMN_REM = 56;
/** Room a floating pill needs beside the chat column (`max-w-36` plus its margin), in rem. */
const FLOATING_PILL_REM = 10;

/**
 * Whether pills fit in the gutter beside the centred chat column. Narrower sessions show them in
 * the header instead, so they never cover the conversation or the composer.
 */
export function canFloatSessionPills(sessionWidth: number, remPx: number): boolean {
  const column = Math.min(sessionWidth - remPx, CHAT_COLUMN_REM * remPx);
  return (sessionWidth - column) / 2 >= FLOATING_PILL_REM * remPx;
}

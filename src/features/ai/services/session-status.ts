import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import type { SessionOutcomeRecord } from "@/features/ai/stores/session-inbox.store";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

/**
 * Where an agent session stands, as its sidebar row shows it:
 * - `running` — a turn or a cloud run is going
 * - `needs-input` — the agent waits on a permission, a question or a sign-in
 * - `failed` — the last turn or cloud run failed
 * - `review` — the agent left edits nobody kept or rejected yet
 * - `pr` — a cloud run opened a pull request
 * - `merged` — that pull request was merged
 * - `idle` — nothing to report
 */
export type SessionStatus =
  | "running"
  | "needs-input"
  | "failed"
  | "review"
  | "pr"
  | "merged"
  | "idle";

export interface SessionStatusSignals {
  working: boolean;
  attention: ChatAttention | null;
  outcome: SessionOutcomeRecord | null;
  unreviewedEdits: number;
  cloudRun: Pick<CloudAgentRun, "status" | "prUrl"> | null;
  /** The cloud run's pull request was merged, when that is known. */
  prMerged?: boolean;
}

/** The one status a session row shows, the most urgent first. */
export function getSessionStatus(signals: SessionStatusSignals): SessionStatus {
  if (signals.attention) return "needs-input";
  const run = signals.cloudRun;
  if (signals.working || run?.status === "queued" || run?.status === "running") return "running";
  if (run?.status === "failed") return "failed";
  if (run) {
    if (run.prUrl) return signals.prMerged ? "merged" : "pr";
    return "idle";
  }
  if (signals.outcome?.outcome === "error") return "failed";
  if (signals.unreviewedEdits > 0) return "review";
  return "idle";
}

/** Whether a session belongs in the Inbox: it waits on the user, or ended while unseen. */
export function needsUserAttention(status: SessionStatus, unread: boolean): boolean {
  return status === "needs-input" || (unread && status !== "running");
}

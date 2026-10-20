import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

/**
 * Where an agent session stands, as its sidebar row shows it:
 * - `running` — a turn or a cloud run is going
 * - `needs-input` — the agent waits on a permission, a question or a sign-in
 * - `failed` — the cloud run failed
 * - `review` — the agent left edits nobody kept or rejected yet
 * - `pr` — a pull request is open for the session's branch or its cloud run
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
  unreviewedEdits: number;
  cloudRun: Pick<CloudAgentRun, "status" | "prUrl"> | null;
  /** Where the pull request of the session's branch or cloud run stands, when one is known. */
  pullRequest?: SessionPullRequestState | null;
}

/** Where a session's pull request stands on GitHub. */
export type SessionPullRequestState = "open" | "merged" | "closed";

/** The one status a session row shows, the most urgent first. */
export function getSessionStatus(signals: SessionStatusSignals): SessionStatus {
  if (signals.attention) return "needs-input";
  const run = signals.cloudRun;
  if (signals.working || run?.status === "queued" || run?.status === "running") return "running";
  if (run?.status === "failed") return "failed";
  if (run) {
    if (run.prUrl) return signals.pullRequest === "merged" ? "merged" : "pr";
    return "idle";
  }
  if (signals.pullRequest === "merged") return "merged";
  if (signals.unreviewedEdits > 0) return "review";
  if (signals.pullRequest === "open") return "pr";
  return "idle";
}

/** The number of the pull request a GitHub pull request URL points at. */
export function getPullRequestNumber(url: string | null | undefined): number | null {
  const match = url?.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return match ? Number(match[1]) : null;
}

/** Where a pull request stands, from GitHub's details of it. */
export function readPullRequestState(details: {
  state: string;
  mergedAt?: string | null;
}): SessionPullRequestState {
  const state = details.state.toUpperCase();
  if (details.mergedAt || state === "MERGED") return "merged";
  return state === "OPEN" ? "open" : "closed";
}

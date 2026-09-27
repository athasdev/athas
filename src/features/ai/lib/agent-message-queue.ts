import type { AgentStopNotice } from "@/features/ai/types/ai-chat.types";

/**
 * How an agent turn ended, as far as the chat's queued follow-ups care.
 * `interrupted` is a turn the user cut short to send a queued message now.
 */
export type AgentRunEnding = "completed" | "interrupted" | "stopped" | "refused" | "failed";

/**
 * Whether queued follow-ups start when a turn ends this way. Like Zed, the queue
 * only moves on after a turn that ended normally. A stop, a refusal or an error
 * holds it, so messages written for a different outcome do not fire blindly; the
 * user can send one now, edit it, or send a new message, whose turn resumes it.
 */
export function continuesAgentQueue(ending: AgentRunEnding): boolean {
  return ending === "completed" || ending === "interrupted";
}

/** Classifies a turn that ended without an error. */
export function getAgentRunEnding(
  cancelled: boolean,
  stopNotice?: AgentStopNotice,
): AgentRunEnding {
  if (cancelled) return "stopped";
  if (stopNotice === "prompt_refused" || stopNotice === "refused") return "refused";
  return "completed";
}

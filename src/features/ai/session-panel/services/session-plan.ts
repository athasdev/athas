import type { AcpPlanEntry } from "@/features/ai/types/acp.types";
import type { Message } from "@/features/ai/types/ai-chat.types";

export interface SessionPlan {
  entries: AcpPlanEntry[];
  isStreaming: boolean;
  done: number;
}

/** The plan of the session's latest turn that has one; agents resend the whole list each time. */
export function getLatestSessionPlan(messages: readonly Message[]): SessionPlan | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.plan?.length) continue;
    return {
      entries: message.plan,
      isStreaming: Boolean(message.isStreaming),
      done: message.plan.filter((entry) => entry.status === "completed").length,
    };
  }
  return null;
}

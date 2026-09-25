import type { AcpStopReason } from "@/features/ai/types/acp.types";

export interface AgentCompletionResult {
  outcome: "completed" | "cancelled";
  /** Why an ACP prompt turn ended, when the agent reported it. */
  stopReason?: AcpStopReason;
}

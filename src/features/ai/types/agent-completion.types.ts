import type { AcpStopReason, AcpTurnUsage } from "@/features/ai/types/acp.types";

export interface AgentCompletionResult {
  outcome: "completed" | "cancelled";
  /** Why an ACP prompt turn ended, when the agent reported it. */
  stopReason?: AcpStopReason;
  /** The tokens the turn used, when the agent reported them. */
  usage?: AcpTurnUsage;
}

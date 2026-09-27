import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";

/**
 * How a run of Athas's own agent ended. It is an `AgentCompletionResult`, so the chat handles it
 * like an ACP turn: `stopReason` "max_turn_requests" (step budget reached) and "max_tokens"
 * (output limit hit) show the Continue affordance, and `usage` is the turn's token total.
 */
export interface IntelligenceAgentResult extends AgentCompletionResult {
  /** Model requests the turn made, including the one that ended it. */
  steps: number;
  /** What the turn cost in US dollars, when the provider reported it. */
  costUsd?: number;
  /** Things the user should know about the turn, such as images that were not sent. */
  notices?: string[];
}

/** The error a failed run throws: a readable message plus what the UI needs to act on it. */
export interface IntelligenceAgentErrorDetails {
  /** A machine-readable reason from the server, such as `http_429` or `allowance_exhausted`. */
  code?: string;
  statusCode?: number;
}

import type { AcpStopReason } from "@/features/ai/types/acp.types";
import type { AgentStopNotice, Message } from "@/features/ai/types/ai-chat.types";
import type { ChatFollowUpAction } from "@/features/ai/lib/follow-up-actions";

const STOP_NOTICES = new Set<string>([
  "max_tokens",
  "max_turn_requests",
  "prompt_refused",
  "refused",
] satisfies AgentStopNotice[]);

/** What the chat sends when the user asks the agent to pick up where it stopped. */
export const AGENT_CONTINUE_PROMPT = "Continue";

const CONTINUE_ACTION: ChatFollowUpAction = {
  id: "continue-turn",
  label: "Continue",
  prompt: AGENT_CONTINUE_PROMPT,
  icon: "Play",
};

/**
 * Whether the agent refused after reading tool output rather than refusing the
 * prompt itself. Like Zed, a completed tool call that returned output means
 * the refusal came from what the tool returned.
 */
function refusedAfterToolOutput(message: Message | undefined): boolean {
  return Boolean(
    message?.toolCalls?.some(
      (toolCall) =>
        toolCall.status === "completed" &&
        (toolCall.output !== undefined || toolCall.rawOutput !== undefined),
    ),
  );
}

/**
 * Maps an ACP stop reason to the notice the chat shows under the reply.
 * `end_turn` and `cancelled` are ordinary endings and need none.
 */
export function getAgentStopNotice(
  stopReason: AcpStopReason | undefined,
  message: Message | undefined,
): AgentStopNotice | undefined {
  switch (stopReason) {
    case "max_tokens":
    case "max_turn_requests":
      return stopReason;
    case "refusal":
      return refusedAfterToolOutput(message) ? "refused" : "prompt_refused";
    default:
      return undefined;
  }
}

export function parseAgentStopNotice(value: unknown): AgentStopNotice | undefined {
  return typeof value === "string" && STOP_NOTICES.has(value)
    ? (value as AgentStopNotice)
    : undefined;
}

export function describeAgentStopNotice(notice: AgentStopNotice): {
  title: string;
  description: string;
} {
  switch (notice) {
    case "max_tokens":
      return {
        title: "The response hit the model's output limit",
        description: "The reply was cut off. Continue to let the agent pick up where it stopped.",
      };
    case "max_turn_requests":
      return {
        title: "The agent reached its request limit for this turn",
        description: "It stopped before finishing. Continue to let it keep going.",
      };
    case "prompt_refused":
      return {
        title: "The agent refused this prompt",
        description: "Rephrase the request and send it again.",
      };
    case "refused":
      return {
        title: "The agent refused to continue",
        description: "It stopped after reviewing tool output.",
      };
  }
}

/** A turn cut short by a limit can be resumed with a Continue follow-up. */
export function getAgentStopFollowUpActions(message: Message): ChatFollowUpAction[] {
  return message.stopNotice === "max_tokens" || message.stopNotice === "max_turn_requests"
    ? [CONTINUE_ACTION]
    : [];
}

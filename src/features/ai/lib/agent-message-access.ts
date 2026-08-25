import type { AgentMessageSubmitResult, AgentType } from "@/features/ai/types/ai-chat.types";

export function getAgentMessageAccess(
  agentId: AgentType,
  hasProviderApiKey: boolean,
): AgentMessageSubmitResult {
  if (agentId !== "custom" || hasProviderApiKey) {
    return { accepted: true };
  }

  return {
    accepted: false,
    error: "Configure an API key before sending a message with the custom provider.",
  };
}

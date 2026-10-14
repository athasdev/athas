import type { AgentMessageSubmitResult, AgentType } from "@/features/ai/types/ai-chat.types";
import { getProviderById } from "@/features/ai/types/providers.types";

/**
 * Why Athas's own agent can't send with this provider: Athas models need an Athas account, the
 * others need the user's API key for that provider.
 */
export function getProviderAccessError(providerId: string): string {
  if (providerId === "athas") return "Sign in to Athas to use Athas models.";
  const name = getProviderById(providerId)?.name ?? "this provider";
  return `Add your ${name} API key in Settings to use ${name} models.`;
}

export function getAgentMessageAccess(
  agentId: AgentType,
  hasProviderAccess: boolean,
  providerId?: string,
): AgentMessageSubmitResult {
  if (agentId !== "custom" || hasProviderAccess) {
    return { accepted: true };
  }

  return {
    accepted: false,
    error: providerId
      ? getProviderAccessError(providerId)
      : "Add an API key in Settings to use this provider.",
  };
}

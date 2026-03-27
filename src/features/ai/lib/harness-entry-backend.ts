import { getDefaultAgentIdForScope } from "@/features/ai/store/scope-defaults";
import type { AgentType } from "@/features/ai/types/ai-chat";
import { createHarnessChatScopeId, DEFAULT_HARNESS_SESSION_KEY } from "./chat-scope";
import type { HarnessRuntimeBackend } from "./harness-runtime-backend";

export const getPreferredHarnessBackendForAgent = (agentId: AgentType): HarnessRuntimeBackend =>
  agentId === "pi" ? "pi-native" : "legacy-acp-bridge";

export const getPreferredHarnessEntryBackend = (
  sessionId = DEFAULT_HARNESS_SESSION_KEY,
): HarnessRuntimeBackend => {
  const scopeId = createHarnessChatScopeId(sessionId);
  const agentId = getDefaultAgentIdForScope(scopeId);
  return getPreferredHarnessBackendForAgent(agentId);
};

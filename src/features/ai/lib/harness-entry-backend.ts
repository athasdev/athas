import { getDefaultAgentIdForScope } from "@/features/ai/store/scope-defaults";
import type { AgentType } from "@/features/ai/types/ai-chat";
import { createHarnessChatScopeId, DEFAULT_HARNESS_SESSION_KEY } from "./chat-scope";
import type { HarnessRuntimeBackend } from "./harness-runtime-backend";

export const getPreferredHarnessBackendForAgent = (
  agentId: AgentType,
  preferredPiBackend: HarnessRuntimeBackend = "pi-native",
): HarnessRuntimeBackend => (agentId === "pi" ? preferredPiBackend : "legacy-acp-bridge");

export const getPreferredHarnessEntryBackend = (
  sessionId = DEFAULT_HARNESS_SESSION_KEY,
  preferredPiBackend: HarnessRuntimeBackend = "pi-native",
): HarnessRuntimeBackend => {
  const scopeId = createHarnessChatScopeId(sessionId);
  const agentId = getDefaultAgentIdForScope(scopeId);
  return getPreferredHarnessBackendForAgent(agentId, preferredPiBackend);
};

export const resolveRestoredHarnessBufferBackend = (
  sessionId: string,
  persistedBackend: HarnessRuntimeBackend,
  preferredPiBackend: HarnessRuntimeBackend = "pi-native",
): HarnessRuntimeBackend => {
  if (sessionId !== DEFAULT_HARNESS_SESSION_KEY) {
    return persistedBackend;
  }

  return getPreferredHarnessEntryBackend(sessionId, preferredPiBackend);
};

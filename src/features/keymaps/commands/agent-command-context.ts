import { canLogOutOfAcpAgent } from "@/features/ai/lib/acp-logout";
import { selectAcpAgentStatus } from "@/features/ai/lib/acp-session-state";
import { canBrowseAgentSessions } from "@/features/ai/lib/open-agent-sessions";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import type { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

type AIChatState = ReturnType<typeof useAIChatStore.getState>;

/** The current chat's agent, or the agent picked for the next chat. */
export function selectCurrentAgentId(state: AIChatState): AgentType {
  return (
    state.chats.find((chat) => chat.id === state.currentChatId)?.agentId ?? state.selectedAgentId
  );
}

/** The current chat's running agent, when it advertises ACP logout. */
export function selectLogOutAgentId(
  state: AIChatState,
  workspacePath: string | null | undefined,
): string | null {
  const agentId = selectCurrentAgentId(state);
  const status = selectAcpAgentStatus(state, agentId, workspacePath);
  return canLogOutOfAcpAgent(status, agentId) ? agentId : null;
}

/** The current chat's running agent, when it lists its sessions (ACP `session/list`). */
export function selectBrowseSessionsAgentId(
  state: AIChatState,
  workspacePath: string | null | undefined,
): string | null {
  const agentId = selectCurrentAgentId(state);
  const status = selectAcpAgentStatus(state, agentId, workspacePath);
  return isAcpAgent(agentId) && canBrowseAgentSessions(status, agentId) ? agentId : null;
}

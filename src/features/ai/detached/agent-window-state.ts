import type { AIChatState } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { AgentWindowDraft } from "./agent-window-drafts";
import type { getAccountIdentity } from "@/features/window/lib/account-identity";

export type AgentAccountIdentity = ReturnType<typeof getAccountIdentity>;

export interface AgentWindowSnapshot {
  accountIdentity?: AgentAccountIdentity;
  chat: Pick<AIChatState, "chats" | "currentChatId" | "selectedAgentId" | "chatMessageLoadStates">;
  workspacePath: string | undefined;
  buffers: PaneContent[];
  activeBufferId: string | null;
  drafts: Record<string, AgentWindowDraft>;
}

export function getAgentWindowTransferBlocker(
  state: Pick<
    AIChatState,
    "agentRuns" | "pendingAgentLaunchRequest" | "agentMessageQueues" | "chatMessageLoadStates"
  >,
  chatId?: string,
) {
  if (
    (state.pendingAgentLaunchRequest &&
      (!chatId || state.pendingAgentLaunchRequest.chatId === chatId)) ||
    (chatId ? state.agentRuns[chatId] : Object.keys(state.agentRuns).length > 0) ||
    (chatId
      ? state.agentMessageQueues[chatId]?.length
      : Object.values(state.agentMessageQueues).some((queue) => queue.length > 0))
  ) {
    return "Wait for this agent to finish, or stop it, before opening it in another window.";
  }
  return null;
}

export function parseAgentWindowChannel(url: URL) {
  if (url.searchParams.get("view") !== "agents") return null;
  const channel = url.searchParams.get("agentWindow");
  return channel && /^[a-zA-Z0-9-]+$/.test(channel) ? channel : null;
}

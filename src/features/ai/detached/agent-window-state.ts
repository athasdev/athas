import type { AIChatState } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { AgentWindowDraft } from "./agent-window-drafts";

export interface AgentWindowSnapshot {
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
) {
  if (
    state.pendingAgentLaunchRequest ||
    Object.keys(state.agentRuns).length > 0 ||
    Object.values(state.agentMessageQueues).some((queue) => queue.length > 0)
  ) {
    return "Wait for agents to finish, or stop them, before moving the Agents view.";
  }
  return null;
}

export function parseAgentWindowChannel(url: URL) {
  if (url.searchParams.get("view") !== "agents") return null;
  const channel = url.searchParams.get("agentWindow");
  return channel && /^[a-zA-Z0-9-]+$/.test(channel) ? channel : null;
}

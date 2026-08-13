import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isTerminalAgent } from "./terminal-agents";
import { openTerminalAgent } from "./terminal-agent-terminal";

export function openNewAgentChat(agentId?: AgentType): string | null {
  const chatStore = useAIChatStore.getState();
  const nextAgentId = agentId ?? chatStore.actions.getCurrentAgentId();

  if (isTerminalAgent(nextAgentId)) {
    return openTerminalAgent(nextAgentId);
  }

  const chatId = chatStore.actions.createNewChat(nextAgentId, { activate: false });
  return useBufferStore.getState().actions.openAgentBuffer(chatId);
}

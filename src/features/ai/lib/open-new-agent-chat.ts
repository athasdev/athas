import type { AgentType } from "@/features/ai/types/ai-chat.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isTerminalAgent } from "./terminal-agents";
import { openTerminalAgent } from "./terminal-agent-terminal";

interface OpenNewAgentChatOptions {
  editorSelections?: EditorSelectionContext[];
}

export function openNewAgentChat(
  agentId?: AgentType,
  options: OpenNewAgentChatOptions = {},
): string | null {
  const chatStore = useAIChatStore.getState();
  const requestedAgentId = agentId ?? chatStore.actions.getCurrentAgentId();
  const nextAgentId =
    options.editorSelections?.length && isTerminalAgent(requestedAgentId)
      ? "custom"
      : requestedAgentId;

  if (isTerminalAgent(nextAgentId)) {
    return openTerminalAgent(nextAgentId);
  }

  const chatId = chatStore.actions.createNewChat(nextAgentId, { activate: false });
  if (options.editorSelections?.length) {
    chatStore.actions.setPendingAgentLaunchRequest({
      chatId,
      agentId: nextAgentId,
      prompt: null,
      selectedBufferIds: [],
      selectedFilesPaths: [],
      editorSelections: options.editorSelections,
    });
  }
  return useBufferStore.getState().actions.openAgentBuffer(chatId);
}

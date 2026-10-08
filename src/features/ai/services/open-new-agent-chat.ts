import type { AgentType } from "@/features/ai/types/ai-chat.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { migrateLegacyAgentId } from "./agent-clis";
import { openAgentWindowSession } from "@/features/ai/detached/agent-window-service";

interface OpenNewAgentChatOptions {
  editorSelections?: EditorSelectionContext[];
}

export function openNewAgentChat(
  agentId?: AgentType,
  options: OpenNewAgentChatOptions = {},
): string | null {
  const chatStore = useAIChatStore.getState();
  // Every agent opens in the chat, never in a terminal, including ids saved before the
  // terminal-only agents moved to ACP.
  const nextAgentId = migrateLegacyAgentId(agentId ?? chatStore.actions.getCurrentAgentId());

  const chatId = chatStore.actions.createNewChat(nextAgentId, {
    activate: false,
    // A pending launch request needs its own session; a bare "New Agent" does not.
    reuseEmpty: !options.editorSelections?.length,
  });
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
  return (
    openAgentWindowSession(chatId) ?? useBufferStore.getState().actions.openAgentBuffer(chatId)
  );
}

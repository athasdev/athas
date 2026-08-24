import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import type { CodexThreadSummary } from "@/features/ai/integrations/codex/codex-types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

function getCodexThreadTitle(thread: CodexThreadSummary) {
  return thread.name?.trim() || thread.preview.trim() || "Codex Session";
}

export function openCodexThread(thread: CodexThreadSummary): string {
  const store = useAIChatStore.getState();
  const existingChat = store.chats.find(
    (chat) => chat.agentId === CODEX_INTEGRATION_ID && chat.acpSessionId === thread.id,
  );
  const chatId =
    existingChat?.id ??
    store.actions.createNewChat(CODEX_INTEGRATION_ID, {
      activate: false,
    });

  if (!existingChat) {
    store.actions.setChatAcpSessionId(chatId, thread.id);
    store.actions.updateChatTitle(chatId, getCodexThreadTitle(thread));
  }

  return useBufferStore.getState().actions.openAgentBuffer(chatId);
}

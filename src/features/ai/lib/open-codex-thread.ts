import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { readCodexThreadMessages } from "@/features/ai/integrations/codex/codex-thread-history";
import type { CodexThreadSummary } from "@/features/ai/integrations/codex/codex-types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

function getCodexThreadTitle(thread: CodexThreadSummary) {
  return thread.name?.trim() || thread.preview.trim() || "Codex Session";
}

function loadCodexThread(chatId: string, threadId: string) {
  const state = useAIChatStore.getState();
  const chat = state.actions.getChatById(chatId);
  const loadState = state.chatMessageLoadStates[chatId];
  if (!chat || chat.messages.length > 0 || loadState === "loading") return;

  state.actions.setChatMessageLoadState(chatId, "loading");
  void readCodexThreadMessages(threadId)
    .then((messages) => {
      const latestState = useAIChatStore.getState();
      const latestChat = latestState.actions.getChatById(chatId);
      if (latestChat?.acpSessionId !== threadId) return;

      latestState.actions.replaceChatMessages(chatId, messages);
      latestState.actions.setChatMessageLoadState(chatId, "loaded");
    })
    .catch((error) => {
      const latestState = useAIChatStore.getState();
      const latestChat = latestState.actions.getChatById(chatId);
      if (latestChat?.acpSessionId !== threadId) return;

      latestState.actions.setChatMessageLoadState(chatId, "error");
      console.error(`Failed to load Codex thread ${threadId}:`, error);
    });
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

  loadCodexThread(chatId, thread.id);
  return useBufferStore.getState().actions.openAgentBuffer(chatId);
}

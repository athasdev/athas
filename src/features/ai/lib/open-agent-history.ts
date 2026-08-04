import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

export function openAgentHistoryChat(chatId: string): string {
  const chatStore = useAIChatStore.getState();
  const chat = chatStore.actions.getChatById(chatId);
  const isPendingLaunch = chatStore.pendingAgentLaunchRequest?.chatId === chatId;

  if (chat && chat.messages.length === 0 && !isPendingLaunch) {
    void chatStore.actions.loadChatMessages(chatId);
  }

  return useBufferStore.getState().actions.openAgentBuffer(chatId);
}

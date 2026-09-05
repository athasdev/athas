import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import {
  focusAgentWindow,
  openAgentWindowSession,
} from "@/features/ai/detached/agent-window-service";

export function openAgentHistoryChat(chatId: string): string {
  if (agentIsDetached(chatId)) {
    focusAgentWindow(chatId);
    return chatId;
  }
  const chatStore = useAIChatStore.getState();
  const chat = chatStore.actions.getChatById(chatId);
  const isPendingLaunch = chatStore.pendingAgentLaunchRequest?.chatId === chatId;

  if (chat && chat.messages.length === 0 && !isPendingLaunch) {
    void chatStore.actions.loadChatMessages(chatId);
  }

  return (
    openAgentWindowSession(chatId) ?? useBufferStore.getState().actions.openAgentBuffer(chatId)
  );
}

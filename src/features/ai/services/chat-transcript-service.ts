import { formatChatTranscript } from "../lib/chat-transcript";
import { useAIChatStore } from "../stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { showToast } from "@/utils/toast";

export async function openChatTranscript(chatId: string): Promise<string | null> {
  let state = useAIChatStore.getState();
  if (state.chatMessageLoadStates[chatId] !== "loaded" && !state.agentRuns[chatId]) {
    await state.actions.loadChatMessages(chatId);
    state = useAIChatStore.getState();
    if (state.chatMessageLoadStates[chatId] !== "loaded") {
      showToast({ type: "error", message: "Could not load the conversation" });
      return null;
    }
  }
  const chat = state.actions.getChatById(chatId);
  if (!chat) return null;
  return useBufferStore.getState().actions.openContent({
    type: "editor",
    path: `agent-transcript://${encodeURIComponent(chatId)}/${Date.now()}.md`,
    name: `${chat.title.trim() || "Agent"}.md`,
    content: formatChatTranscript(chat),
    isVirtual: true,
    language: "markdown",
  });
}

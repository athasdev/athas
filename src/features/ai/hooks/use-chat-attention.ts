import { getChatAttention } from "@/features/ai/lib/chat-attention";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

/** What the chat is waiting on the user for, or null. */
export function useChatAttention(chatId: string | null | undefined): ChatAttention | null {
  const sessionId = useAIChatStore((state) =>
    chatId ? (state.chats.find((chat) => chat.id === chatId)?.acpSessionId ?? null) : null,
  );
  const pendingPermissions = useAgentPermissionsStore((state) =>
    chatId ? state.permissions.filter((item) => item.chatId === chatId).length : 0,
  );
  const questions = useAcpQuestionsStore.use.questions();
  const authRequest = useAcpAuthStore.use.request();
  if (!chatId) return null;
  return getChatAttention({ chatId, sessionId, pendingPermissions, questions, authRequest });
}

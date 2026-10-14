import { isAgentSessionWorking } from "@/features/ai/lib/agent-session-groups";
import { getChatAttention } from "@/features/ai/lib/chat-attention";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

export interface ProjectAgentStatus {
  /** What the first session waiting on the user is waiting for. */
  attention: ChatAttention | null;
  /** Whether any session is writing a reply. */
  working: boolean;
}

/** The combined state of a project's agent sessions, for its collapsed sidebar header. */
export function useProjectAgentStatus(
  chats: readonly Pick<ChatSession, "id" | "acpSessionId">[],
): ProjectAgentStatus {
  const working = useAIChatStore((state) =>
    chats.some((chat) => isAgentSessionWorking(state.messagesByChat[chat.id])),
  );
  const permissions = useAgentPermissionsStore.use.permissions();
  const questions = useAcpQuestionsStore.use.questions();
  const authRequest = useAcpAuthStore.use.request();
  let attention: ChatAttention | null = null;
  for (const chat of chats) {
    attention = getChatAttention({
      chatId: chat.id,
      sessionId: chat.acpSessionId,
      pendingPermissions: permissions.filter((item) => item.chatId === chat.id).length,
      questions,
      authRequest,
    });
    if (attention) break;
  }
  return { attention, working };
}

import { useMemo } from "react";
import { isAgentSessionWorking } from "@/features/ai/lib/agent-session-groups";
import { getChatAttention } from "@/features/ai/lib/chat-attention";
import { selectAgentSessions } from "@/features/ai/services/agent-session-list";
import { needsUserAttention } from "@/features/ai/services/session-status";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useSessionInboxStore } from "@/features/ai/stores/session-inbox.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";

/**
 * The sessions that need the user, newest first: those waiting on a permission, a question or a
 * sign-in, and those whose turn finished or failed while nobody looked.
 */
export function useInboxSessions(): ChatSession[] {
  const chats = useAIChatStore((state) => state.chats);
  const messagesByChat = useAIChatStore((state) => state.messagesByChat);
  const permissions = useAgentPermissionsStore.use.permissions();
  const questions = useAcpQuestionsStore.use.questions();
  const authRequest = useAcpAuthStore.use.request();
  const outcomes = useSessionInboxStore.use.outcomes();

  return useMemo(
    () =>
      selectAgentSessions(chats, { anyWorkspace: true, includeEmpty: true })
        .filter((chat) => {
          const attention = getChatAttention({
            chatId: chat.id,
            sessionId: chat.acpSessionId,
            pendingPermissions: permissions.filter((item) => item.chatId === chat.id).length,
            questions,
            authRequest,
          });
          const status = attention
            ? "needs-input"
            : isAgentSessionWorking(messagesByChat[chat.id])
              ? "running"
              : "idle";
          return needsUserAttention(status, Boolean(outcomes[chat.id]?.unread));
        })
        .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime()),
    [authRequest, chats, messagesByChat, outcomes, permissions, questions],
  );
}

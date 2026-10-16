import { useMemo } from "react";
import { useCloudRun } from "@/features/ai/cloud-agents/hooks/use-cloud-runs";
import { getLatestCloudRun } from "@/features/ai/cloud-agents/services/cloud-environment";
import { isAgentSessionWorking } from "@/features/ai/lib/agent-session-groups";
import { getChatAttention } from "@/features/ai/lib/chat-attention";
import { getSessionStatus, type SessionStatus } from "@/features/ai/services/session-status";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAcpQuestionsStore } from "@/features/ai/stores/acp-questions.store";
import { useAgentEditEntries } from "@/features/ai/stores/agent-edits.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useSessionInboxStore } from "@/features/ai/stores/session-inbox.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

export interface SessionRowStatus {
  status: SessionStatus;
  attention: ChatAttention | null;
  /** The session ended a turn the user has not looked at. */
  unread: boolean;
}

/** Where one session stands, for its sidebar row and the Inbox. */
export function useSessionStatus(
  chat: Pick<ChatSession, "id" | "acpSessionId" | "sessionSettings">,
): SessionRowStatus {
  const working = useAIChatStore((state) => isAgentSessionWorking(state.messagesByChat[chat.id]));
  const pendingPermissions = useAgentPermissionsStore(
    (state) => state.permissions.filter((item) => item.chatId === chat.id).length,
  );
  const questions = useAcpQuestionsStore.use.questions();
  const authRequest = useAcpAuthStore.use.request();
  const outcome = useSessionInboxStore((state) => state.outcomes[chat.id] ?? null);
  const unreviewedEdits = Object.keys(useAgentEditEntries(chat.id)).length;
  const cloudRun = useCloudRun(getLatestCloudRun(chat.sessionSettings?.cloud ?? null)?.runId);
  const attention = getChatAttention({
    chatId: chat.id,
    sessionId: chat.acpSessionId,
    pendingPermissions,
    questions,
    authRequest,
  });
  const status = getSessionStatus({ working, attention, outcome, unreviewedEdits, cloudRun });
  const unread = Boolean(outcome?.unread);
  return useMemo(() => ({ status, attention, unread }), [attention, status, unread]);
}

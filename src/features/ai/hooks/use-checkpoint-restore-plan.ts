import { useEffect, useMemo } from "react";
import {
  ensureCheckpointsLoaded,
  planChatRestore,
} from "@/features/ai/services/agent-checkpoints-service";
import { useAgentCheckpointsStore } from "@/features/ai/stores/agent-checkpoints.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { CheckpointRestorePlan } from "@/features/ai/types/agent-checkpoints.types";

/**
 * What restoring the chat to before `messageId` would change, re-rendering as the chat's agent
 * writes. Null while nothing at or after that message changed a file, or once it can't be
 * restored any more.
 */
export function useCheckpointRestorePlan(
  chatId: string | null | undefined,
  messageId: string,
): CheckpointRestorePlan | null {
  const checkpoints = useAgentCheckpointsStore((state) =>
    chatId ? state.byChat[chatId] : undefined,
  );
  const messages = useAIChatStore((state) =>
    chatId ? state.chats.find((chat) => chat.id === chatId)?.messages : undefined,
  );

  useEffect(() => {
    if (chatId) void ensureCheckpointsLoaded(chatId);
  }, [chatId]);

  return useMemo(() => {
    if (!checkpoints || !messages) return null;
    const plan = planChatRestore(checkpoints, messageId, messages);
    return plan === "unavailable" ? null : plan;
  }, [checkpoints, messageId, messages]);
}

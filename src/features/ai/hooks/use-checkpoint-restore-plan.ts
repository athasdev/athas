import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  isCheckpointAvailable,
  planCheckpointRestore,
} from "@/features/ai/lib/agent-edit-checkpoints";
import { ensureCheckpointsLoaded } from "@/features/ai/services/agent-checkpoints-service";
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
  // Only the message order and this message's time matter, so a streamed token re-renders nothing.
  const messageIds = useAIChatStore(
    useShallow((state) =>
      chatId ? state.messagesByChat[chatId]?.map((message) => message.id) : undefined,
    ),
  );
  const timestamp = useAIChatStore((state) =>
    chatId
      ? (state.messagesByChat[chatId]?.find((message) => message.id === messageId)?.timestamp ??
        null)
      : null,
  );

  useEffect(() => {
    if (chatId) void ensureCheckpointsLoaded(chatId);
  }, [chatId]);

  return useMemo(() => {
    if (!checkpoints || !messageIds) return null;
    const plan = planCheckpointRestore(checkpoints, messageId, messageIds);
    if (!plan) return null;
    return isCheckpointAvailable(checkpoints, timestamp?.getTime() ?? null) ? plan : null;
  }, [checkpoints, messageId, messageIds, timestamp]);
}

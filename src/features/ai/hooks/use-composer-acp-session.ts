import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import {
  type ComposerAcpSession,
  selectComposerAcpSession,
} from "@/features/ai/services/acp-session-state";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpOptionTarget } from "@/features/ai/types/acp.types";
import { useProjectStore } from "@/features/workspace/stores/project.store";

/** Picking agents in a row only prepares the one the user stays on. */
const PREPARE_DELAY_MS = 300;

/**
 * What the composer of `chatId` shows for its ACP agent (see `selectComposerAcpSession`), and
 * where its picks go.
 */
export function useComposerAcpSession(
  chatId: string | null | undefined,
  agentId: string,
): ComposerAcpSession & { target: AcpOptionTarget } {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const chatWorkspacePath = useAIChatStore((state) =>
    chatId ? state.chats.find((chat) => chat.id === chatId)?.workspacePath : undefined,
  );
  const workspacePath = chatWorkspacePath ?? rootFolderPath ?? null;
  const target = useMemo(
    () => ({ chatId: chatId ?? null, agentId, workspacePath }),
    [agentId, chatId, workspacePath],
  );
  const session = useAIChatStore(useShallow((state) => selectComposerAcpSession(state, target)));
  return { ...session, target };
}

/**
 * Opens the composer's ACP session in the background as soon as an ACP agent is picked, or a chat
 * with one is shown, so its models, modes and options are there before the first prompt. It does
 * so once per agent and chat: an agent that later stops for being idle is not started again just
 * because its composer is still on screen, and shows its last known options instead.
 */
export function usePrepareAcpSession(
  {
    target,
    sessionId,
    isLoading,
  }: Pick<ReturnType<typeof useComposerAcpSession>, "target" | "sessionId" | "isLoading">,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const needsSession = enabled && isAcpAgent(target.agentId) && !sessionId && !isLoading;
  const ownSessionId = useAIChatStore((state) =>
    target.chatId
      ? (state.chats.find((chat) => chat.id === target.chatId)?.acpSessionId ?? null)
      : null,
  );

  const preparedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!needsSession) return;
    const key = [target.agentId, target.chatId, target.workspacePath, ownSessionId].join("\u0000");
    if (preparedKey.current === key) return;
    const timer = setTimeout(() => {
      preparedKey.current = key;
      void AcpStreamHandler.prepare(target.agentId, target.chatId);
    }, PREPARE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [needsSession, ownSessionId, target]);
}

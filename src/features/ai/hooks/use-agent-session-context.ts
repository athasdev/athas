import { useEffect, useMemo } from "react";
import { buildAgentSessionContext } from "@/features/ai/lib/agent-session-context";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useSettledChatMessages } from "./use-settled-chat-messages";

/**
 * What an agent session touched (changes, files read, commands, links), derived from its
 * transcript and loading its messages when they are not loaded yet.
 */
export function useAgentSessionContext(sessionId: string | null) {
  const chat = useAIChatStore((state) =>
    sessionId ? (state.chats.find((candidate) => candidate.id === sessionId) ?? null) : null,
  );
  const loadState = useAIChatStore((state) =>
    sessionId ? state.chatMessageLoadStates[sessionId] : undefined,
  );
  const loadChatMessages = useAIChatStore((state) => state.actions.loadChatMessages);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath || null);
  // Settled rather than selected: a streaming reply changes the messages every frame.
  const settledMessages = useSettledChatMessages(chat ? sessionId : null);
  const messages = chat ? settledMessages : undefined;
  const context = useMemo(
    () => buildAgentSessionContext(messages ? { messages } : null, rootFolderPath),
    [messages, rootFolderPath],
  );

  useEffect(() => {
    if (!sessionId || loadState === "loaded" || loadState === "loading") return;
    void loadChatMessages(sessionId);
  }, [loadChatMessages, loadState, sessionId]);

  return { chat, context, loadState, messages, rootFolderPath };
}

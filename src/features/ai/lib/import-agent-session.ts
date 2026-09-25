import { acpHistoryToMessages } from "./acp-session-history";
import { openAgentHistoryChat } from "./open-agent-history";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

export interface ImportableAgentSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

/** The chat that already holds `sessionId` on `agentId`, if any. */
export function findChatForAgentSession(agentId: AgentType, sessionId: string): string | null {
  const chat = useAIChatStore
    .getState()
    .chats.find(
      (candidate) => candidate.agentId === agentId && candidate.acpSessionId === sessionId,
    );
  return chat?.id ?? null;
}

/**
 * Brings one of the agent's own sessions into Athas as a new chat and opens it. The agent loads
 * the session and replays its conversation, which becomes the chat's saved messages. A session a
 * chat already holds opens that chat instead. Returns the chat id.
 */
export async function importAgentSession(
  agentId: AgentType,
  session: ImportableAgentSession,
): Promise<string> {
  const existing = findChatForAgentSession(agentId, session.sessionId);
  if (existing) {
    openAgentHistoryChat(existing);
    return existing;
  }

  const opened = await AcpStreamHandler.importSession(agentId, session.sessionId);
  const updatedAt = session.updatedAt ? new Date(session.updatedAt) : null;
  const messages = acpHistoryToMessages(opened.history ?? [], {
    endedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : undefined,
  });

  const { actions } = useAIChatStore.getState();
  const chatId = actions.createNewChat(agentId, { activate: false });
  actions.setChatAcpSessionId(chatId, opened.sessionId);
  const title = session.title?.trim();
  if (title) actions.updateChatTitle(chatId, title);
  actions.replaceChatMessages(chatId, messages);

  openAgentHistoryChat(chatId);
  return chatId;
}

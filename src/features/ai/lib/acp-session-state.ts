import type { AcpAgentStatus, AcpSessionState } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { normalizeAcpWorkspacePath } from "./acp-workspace-path";
import { isTerminalAgent } from "./terminal-agents";

/** What a session shows before the agent told anything about it. Shared so selectors stay stable. */
export const EMPTY_ACP_SESSION_STATE: AcpSessionState = Object.freeze({
  slashCommands: [],
  modeState: Object.freeze({ currentModeId: null, availableModes: [] }),
  configOptions: [],
  usage: null,
}) as AcpSessionState;

/**
 * Identifies the agent process serving `agentId` in `workspacePath`. Every chat that uses the same
 * agent in the same workspace shares one process.
 */
export function getAcpAgentKey(agentId: string, workspacePath: string | null | undefined): string {
  return `${agentId}\u0000${normalizeAcpWorkspacePath(workspacePath) ?? ""}`;
}

interface AcpStateSlice {
  chats: Chat[];
  acpAgents: Record<string, AcpAgentStatus>;
  acpSessions: Record<string, AcpSessionState>;
}

/** The running agent process for `agentId` in `workspacePath`, if any. */
export function selectAcpAgentStatus(
  state: Pick<AcpStateSlice, "acpAgents">,
  agentId: string | null | undefined,
  workspacePath: string | null | undefined,
): AcpAgentStatus | null {
  if (!agentId) return null;
  return state.acpAgents[getAcpAgentKey(agentId, workspacePath)] ?? null;
}

/** The ACP session a chat holds, if the agent has one open for it. */
export function selectChatAcpSessionId(
  state: Pick<AcpStateSlice, "chats">,
  chatId: string | null | undefined,
): string | null {
  if (!chatId) return null;
  return state.chats.find((chat) => chat.id === chatId)?.acpSessionId ?? null;
}

/** The slash commands, modes and config options of a chat's ACP session. */
export function selectChatAcpSession(
  state: AcpStateSlice,
  chatId: string | null | undefined,
): AcpSessionState {
  const sessionId = selectChatAcpSessionId(state, chatId);
  return (sessionId && state.acpSessions[sessionId]) || EMPTY_ACP_SESSION_STATE;
}

/**
 * The ACP session to close when `chat` is deleted. Codex chats keep their thread id in the same
 * field, and API-model and terminal chats have no ACP session.
 */
export function getChatAcpSessionToClose(
  chat: Pick<Chat, "agentId" | "acpSessionId"> | null | undefined,
): string | null {
  if (!chat?.acpSessionId) return null;
  const isAcpAgent =
    chat.agentId !== "custom" &&
    chat.agentId !== CODEX_INTEGRATION_ID &&
    !isTerminalAgent(chat.agentId);
  return isAcpAgent ? chat.acpSessionId : null;
}

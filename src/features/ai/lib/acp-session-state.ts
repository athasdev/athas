import type { AcpAgentStatus, AcpSessionState } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { normalizeAcpWorkspacePath } from "./acp-workspace-path";

/** What a session shows before the agent told anything about it. Shared so selectors stay stable. */
export const EMPTY_ACP_SESSION_STATE: AcpSessionState = Object.freeze({
  slashCommands: [],
  modeState: Object.freeze({ currentModeId: null, availableModes: [] }),
  configOptions: [],
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

import type {
  AcpAgentStatus,
  AcpOptionTarget,
  AcpSessionState,
} from "@/features/ai/types/acp.types";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import type { AcpSessionPrepare } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { normalizeAcpWorkspacePath } from "../lib/acp-workspace-path";

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

/**
 * Identifies a session being prepared: a chat's own earlier session by its id, otherwise the new
 * session a draft of `agentId` in `workspacePath` will take over.
 */
export function getAcpPrepareKey(
  agentId: string,
  workspacePath: string | null | undefined,
  ownSessionId: string | null,
): string {
  return ownSessionId ? `session\u0000${ownSessionId}` : getAcpAgentKey(agentId, workspacePath);
}

/** Whether a session told what it offers: the models, modes and options the composer shows. */
export function hasAcpSessionOptions(session: AcpSessionState | null | undefined): boolean {
  return Boolean(session?.configOptions.length || session?.modeState.availableModes.length);
}

interface AcpStateSlice {
  chats: ChatSession[];
  acpAgents: Record<string, AcpAgentStatus>;
  acpSessions: Record<string, AcpSessionState>;
}

interface ComposerAcpStateSlice extends AcpStateSlice {
  acpPrepares: Record<string, AcpSessionPrepare>;
  acpOptionCache: Record<string, AcpSessionState>;
}

export interface ComposerAcpSession {
  /** The open session the composer's picks go to; null until one reported its options. */
  sessionId: string | null;
  /** The session's modes, options and commands, or the agent's last known ones until then. */
  session: AcpSessionState;
  /** A session is being opened for the composer, so what it shows may still change. */
  isLoading: boolean;
}

/** The chat's own session, which it reattaches; null for a draft or a chat that has none yet. */
export function selectOwnAcpSessionId(
  state: Pick<AcpStateSlice, "chats">,
  { chatId, agentId }: Pick<AcpOptionTarget, "chatId" | "agentId">,
): string | null {
  if (!chatId) return null;
  const chat = state.chats.find((candidate) => candidate.id === chatId);
  return chat?.agentId === agentId ? (chat.acpSessionId ?? null) : null;
}

/**
 * What the composer of `target` shows for its ACP agent: the chat's session, or the session
 * prepared for its first prompt, and the agent's last known options while neither is open yet.
 * Every field keeps its identity between calls while the store does not change.
 */
export function selectComposerAcpSession(
  state: ComposerAcpStateSlice,
  target: AcpOptionTarget,
): ComposerAcpSession {
  const ownSessionId = selectOwnAcpSessionId(state, target);
  const prepare =
    state.acpPrepares[getAcpPrepareKey(target.agentId, target.workspacePath, ownSessionId)];
  const sessionId = ownSessionId ?? (prepare?.status === "ready" ? prepare.sessionId : null);
  const live = sessionId ? state.acpSessions[sessionId] : undefined;
  const isReady = hasAcpSessionOptions(live);
  return {
    sessionId: isReady ? sessionId : null,
    session:
      (isReady ? live : state.acpOptionCache[target.agentId]) ?? live ?? EMPTY_ACP_SESSION_STATE,
    isLoading: !isReady && prepare?.status === "preparing",
  };
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
 * field, and API-model chats have no ACP session.
 */
export function getChatAcpSessionToClose(
  chat: Pick<ChatSession, "agentId" | "acpSessionId"> | null | undefined,
): string | null {
  if (!chat?.acpSessionId) return null;
  const isAcpAgent = chat.agentId !== "custom" && chat.agentId !== CODEX_INTEGRATION_ID;
  return isAcpAgent ? chat.acpSessionId : null;
}

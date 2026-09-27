import type { AcpAgentStatus } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { getChatAcpSessionToClose } from "./acp-session-state";

function advertises(status: AcpAgentStatus, capability: "close" | "resume"): boolean {
  const session = status.agentCapabilities?.sessionCapabilities;
  return (
    typeof session === "object" &&
    session !== null &&
    (session as Record<string, unknown>)[capability] != null
  );
}

/**
 * Whether closing a session loses nothing: the agent closes it on request (`session/close`) and
 * can bring it back later with `session/load` or `session/resume`.
 */
export function canCloseAndReattachSessions(status: AcpAgentStatus): boolean {
  return (
    advertises(status, "close") &&
    (Boolean(status.agentCapabilities?.loadSession) || advertises(status, "resume"))
  );
}

/**
 * The ACP session to close now that the last tab showing `chat` closed, or null to keep it.
 * The chat keeps its session id, so reopening it reattaches the same session. A session that
 * could not be brought back stays open until the agent is idle, and so does one with work in
 * flight or prompts waiting on the user.
 */
export function getSessionToCloseWithTab(input: {
  chat: Pick<Chat, "agentId" | "acpSessionId"> | undefined;
  agents: readonly AcpAgentStatus[];
  isBusy: boolean;
}): string | null {
  const sessionId = getChatAcpSessionToClose(input.chat);
  if (!sessionId || input.isBusy) return null;
  const status = input.agents.find(
    (agent) => agent.running && agent.sessionIds?.includes(sessionId),
  );
  return status && canCloseAndReattachSessions(status) ? sessionId : null;
}

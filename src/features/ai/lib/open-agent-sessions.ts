import type { AcpAgentStatus } from "@/features/ai/types/acp.types";

export const OPEN_AGENT_SESSIONS_EVENT = "athas:open-agent-sessions";

function advertisesSessionCapability(
  status: AcpAgentStatus | null | undefined,
  capability: "list" | "delete",
): boolean {
  const session = status?.agentCapabilities?.sessionCapabilities;
  return (
    typeof session === "object" &&
    session !== null &&
    capability in session &&
    (session as Record<string, unknown>)[capability] != null
  );
}

/** Whether the running agent (optionally `agentId`) lists its sessions (`session/list`). */
export function canBrowseAgentSessions(
  status: AcpAgentStatus | null | undefined,
  agentId?: string | null,
): boolean {
  if (!status?.running || (agentId && status.agentId !== agentId)) return false;
  return advertisesSessionCapability(status, "list");
}

/** Whether the running agent deletes its sessions (`session/delete`). */
export function canDeleteAgentSessions(status: AcpAgentStatus | null | undefined): boolean {
  return Boolean(status?.running) && advertisesSessionCapability(status, "delete");
}

/** Opens the list of `agentId`'s sessions in the current workspace. */
export function openAgentSessions(agentId: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_AGENT_SESSIONS_EVENT, { detail: agentId }));
}

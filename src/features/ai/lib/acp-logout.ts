import { toast } from "sonner";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import type { AcpAgentStatus } from "@/features/ai/types/acp.types";

/** Whether the running agent (optionally `agentId`) advertises the ACP `logout` capability. */
export function canLogOutOfAcpAgent(
  status: AcpAgentStatus | null | undefined,
  agentId?: string | null,
): boolean {
  if (!status?.running || (agentId && status.agentId !== agentId)) return false;
  const auth = status.agentCapabilities?.authCapabilities;
  return typeof auth === "object" && auth !== null && "logout" in auth && auth.logout != null;
}

/**
 * Logs out of the running agent. Athas does not sign it back in on its own: the next prompt
 * that needs sign-in shows the agent's methods to choose from.
 */
export async function logOutOfAcpAgent(): Promise<void> {
  try {
    await AcpStreamHandler.logoutAgent();
    useAcpAuthStore.getState().actions.clear();
    toast.success("Logged out of the agent");
  } catch (error) {
    toast.error("Couldn't log out of the agent", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

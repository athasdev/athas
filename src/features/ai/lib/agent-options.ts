import {
  BUILT_IN_AI_INTEGRATIONS,
  CODEX_INTEGRATION_ID,
} from "@/features/ai/integrations/integration-registry";
import { isTerminalAgent, TERMINAL_AGENT_OPTIONS } from "@/features/ai/lib/terminal-agents";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

const ATHAS_AGENT_OPTION = {
  id: "custom",
  name: "AI Chat",
  description: "Chat directly with a configured model provider",
};

export type AgentAction = "install" | "update";

export interface PendingAgentAction {
  agentId: string;
  action: AgentAction;
}

export interface AgentOption {
  id: AgentType;
  name: string;
  description: string;
  isInstalled: boolean;
  isCurrent: boolean;
  canInstall: boolean;
  isBusy: boolean;
  updateAvailable: boolean;
  action: AgentAction | null;
  needsSetup: boolean;
}

export interface AgentAvailabilityResult {
  agents: AgentConfig[] | null;
  codexInstalled: boolean | null;
  errors: string[];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export async function loadAgentAvailability(
  loadAgents: () => Promise<AgentConfig[]>,
  loadCodexStatus: () => Promise<{ installed: boolean }>,
): Promise<AgentAvailabilityResult> {
  const [agentsResult, codexResult] = await Promise.allSettled([loadAgents(), loadCodexStatus()]);
  const errors: string[] = [];

  if (agentsResult.status === "rejected") {
    errors.push(`Agent catalog: ${errorMessage(agentsResult.reason)}`);
  }
  if (codexResult.status === "rejected") {
    errors.push(`Codex: ${errorMessage(codexResult.reason)}`);
  }

  return {
    agents: agentsResult.status === "fulfilled" ? agentsResult.value : null,
    codexInstalled: codexResult.status === "fulfilled" ? codexResult.value.installed : null,
    errors,
  };
}

export function buildAgentOptions({
  currentAgentId,
  agentConfigs,
  codexInstalled,
  pendingAction,
}: {
  currentAgentId: AgentType;
  agentConfigs: Map<string, AgentConfig>;
  codexInstalled: boolean;
  pendingAction: PendingAgentAction | null;
}): AgentOption[] {
  const registryAgents = Array.from(agentConfigs.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const availableAgents: Array<{ id: string; name: string; description?: string | null }> = [
    ATHAS_AGENT_OPTION,
    ...BUILT_IN_AI_INTEGRATIONS,
    ...TERMINAL_AGENT_OPTIONS,
    ...registryAgents,
  ];
  if (!availableAgents.some((agent) => agent.id === currentAgentId)) {
    availableAgents.push({
      id: currentAgentId,
      name: currentAgentId,
      description: "The selected agent is not available in the current catalog",
    });
  }

  return availableAgents.map((agent) => {
    const agentId = agent.id as AgentType;
    const agentConfig = agentConfigs.get(agent.id);
    const isAthasAgent = agent.id === "custom";
    const isTerminal = isTerminalAgent(agent.id);
    const isIntegration = agent.id === CODEX_INTEGRATION_ID;
    const isInstalled =
      isAthasAgent ||
      isTerminal ||
      (isIntegration ? codexInstalled : (agentConfig?.installed ?? false));
    const canInstall = !isTerminal && !isIntegration && (agentConfig?.canInstall ?? false);
    const updateAvailable = isInstalled && canInstall && (agentConfig?.updateAvailable ?? false);
    const isBusy = pendingAction?.agentId === agent.id;
    const action = isBusy
      ? pendingAction.action
      : !isInstalled && canInstall
        ? "install"
        : updateAvailable
          ? "update"
          : null;

    return {
      id: agentId,
      name: agent.name,
      description: agentConfig?.description ?? agent.description ?? "ACP-compatible coding agent",
      isInstalled,
      isCurrent: agent.id === currentAgentId,
      canInstall,
      isBusy,
      updateAvailable,
      action,
      needsSetup: isIntegration && !isInstalled,
    };
  });
}

export function getAgentErrorMessage(error: unknown): string {
  return errorMessage(error);
}

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import {
  BUILT_IN_AI_INTEGRATIONS,
  CODEX_INTEGRATION_ID,
} from "@/features/ai/integrations/integration-registry";
import { isTerminalAgent, TERMINAL_AGENT_OPTIONS } from "@/features/ai/lib/terminal-agents";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { toast } from "sonner";

const ATHAS_AGENT_OPTION = {
  id: "custom",
  name: "Athas Agent",
  description: "Use Athas Agent settings and provider configuration",
};

export interface AgentOption {
  id: AgentType;
  name: string;
  description: string;
  isInstalled: boolean;
  isCurrent: boolean;
  canInstall: boolean;
  isInstalling: boolean;
}

export function useAgentOptions(currentAgentId: AgentType) {
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [agentConfigs, setAgentConfigs] = useState<Map<string, AgentConfig>>(new Map());
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);

  const loadInstalledAgents = useCallback(async () => {
    try {
      const detectedAgents = await invoke<AgentConfig[]>("get_available_agents");
      const codex = await CodexIntegrationService.status().catch(() => null);
      setAgentConfigs(new Map(detectedAgents.map((agent) => [agent.id, agent])));
      const installed = new Set<string>(["custom"]);
      if (codex?.installed) installed.add(CODEX_INTEGRATION_ID);
      for (const agent of detectedAgents) {
        if (agent.installed) installed.add(agent.id);
      }
      setInstalledAgents(installed);
    } catch {
      setAgentConfigs(new Map());
    }
  }, []);

  useEffect(() => {
    void loadInstalledAgents();
  }, [loadInstalledAgents]);

  const options = useMemo<AgentOption[]>(() => {
    const registryAgents = Array.from(agentConfigs.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const availableAgents = [
      ATHAS_AGENT_OPTION,
      ...BUILT_IN_AI_INTEGRATIONS,
      ...TERMINAL_AGENT_OPTIONS,
      ...registryAgents,
    ];

    return availableAgents.map((agent) => {
      const agentId = agent.id as AgentType;
      const isInstalled = installedAgents.has(agent.id);
      const agentConfig = agentConfigs.get(agent.id);
      const isTerminal = isTerminalAgent(agent.id);
      const isIntegration = agent.id === CODEX_INTEGRATION_ID;

      return {
        id: agentId,
        name: agent.name,
        description: agentConfig?.description ?? agent.description ?? "ACP-compatible coding agent",
        isInstalled: isTerminal || isInstalled,
        isCurrent: agent.id === currentAgentId,
        canInstall:
          agent.id === "custom" || isTerminal || isIntegration
            ? false
            : (agentConfig?.canInstall ?? true),
        isInstalling: installingAgentId === agent.id,
      };
    });
  }, [agentConfigs, currentAgentId, installedAgents, installingAgentId]);

  const installAgent = useCallback(
    async (agentId: AgentType, agentName: string) => {
      if (agentId === "custom" || agentId === CODEX_INTEGRATION_ID || installingAgentId) return;

      setInstallingAgentId(agentId);
      try {
        const installedAgent = await invoke<AgentConfig>("install_acp_agent", { agentId });
        setAgentConfigs((current) => new Map(current).set(installedAgent.id, installedAgent));
        setInstalledAgents((current) => new Set(current).add(installedAgent.id));
        toast.success(`${agentName} installed`);
      } catch (error) {
        toast.error(`Failed to install ${agentName}`, {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setInstallingAgentId(null);
        void loadInstalledAgents();
      }
    },
    [installingAgentId, loadInstalledAgents],
  );

  return { options, installAgent };
}

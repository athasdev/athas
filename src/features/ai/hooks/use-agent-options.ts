import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import {
  buildAgentOptions,
  getAgentErrorMessage,
  loadAgentAvailability,
  type AgentAction,
  type PendingAgentAction,
  type AgentAvailabilityResult,
} from "@/features/ai/lib/agent-options";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { toast } from "sonner";
import { createTimedResourceCache } from "@/utils/timed-resource-cache";

const availabilityCache = createTimedResourceCache<AgentAvailabilityResult>();

export function useAgentOptions(currentAgentId: AgentType) {
  const [agentConfigs, setAgentConfigs] = useState<Map<string, AgentConfig>>(new Map());
  const [codexInstalled, setCodexInstalled] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const pendingActionRef = useRef<PendingAgentAction | null>(null);

  const loadAgents = useCallback(async (showLoading = true, force = false) => {
    const requestId = ++loadRequestIdRef.current;
    if (showLoading) setIsLoading(true);
    setLoadError(null);

    try {
      const result = await availabilityCache.load(
        "agents",
        () =>
          loadAgentAvailability(
            () => invoke<AgentConfig[]>("get_available_agents"),
            () => CodexIntegrationService.status(),
          ),
        { ttlMs: 30_000, force },
      );
      if (requestId !== loadRequestIdRef.current) return;

      if (result.agents) {
        setAgentConfigs(new Map(result.agents.map((agent) => [agent.id, agent])));
      }
      if (result.codexInstalled !== null) {
        setCodexInstalled(result.codexInstalled);
      }
      setLoadError(result.errors.length > 0 ? result.errors.join("\n") : null);
    } catch (error) {
      if (requestId === loadRequestIdRef.current) {
        setLoadError(getAgentErrorMessage(error));
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadAgents]);

  const options = useMemo(
    () => buildAgentOptions({ currentAgentId, agentConfigs, codexInstalled, pendingAction }),
    [agentConfigs, codexInstalled, currentAgentId, pendingAction],
  );

  const runAgentAction = useCallback(
    async (agentId: AgentType, agentName: string, action: AgentAction) => {
      if (agentId === "custom" || agentId === CODEX_INTEGRATION_ID || pendingActionRef.current) {
        return;
      }

      const nextAction = { agentId, action };
      pendingActionRef.current = nextAction;
      setPendingAction(nextAction);
      try {
        const updatedAgent = await invoke<AgentConfig>(
          action === "update" ? "update_acp_agent" : "install_acp_agent",
          { agentId },
        );
        setAgentConfigs((current) => new Map(current).set(updatedAgent.id, updatedAgent));
        toast.success(`${agentName} ${action === "update" ? "updated" : "installed"}`);
      } catch (error) {
        toast.error(`Failed to ${action} ${agentName}`, {
          description: getAgentErrorMessage(error),
        });
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
        void loadAgents(false, true);
      }
    },
    [loadAgents],
  );

  return {
    options,
    isLoading,
    loadError,
    refresh: () => loadAgents(true, true),
    runAgentAction,
  };
}

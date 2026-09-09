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
const availabilityTtlMs = 30_000;

export function useAgentOptions(currentAgentId: AgentType) {
  // This hook mounts and unmounts with the menus that use it. Seeding from the
  // warm cache keeps a reopened menu from flashing "Checking agents…".
  const cached = availabilityCache.getFreshValue("agents", availabilityTtlMs);
  const [agentConfigs, setAgentConfigs] = useState<Map<string, AgentConfig>>(
    () => new Map(cached?.agents?.map((agent) => [agent.id, agent]) ?? []),
  );
  const [codexInstalled, setCodexInstalled] = useState(cached?.codexInstalled ?? false);
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null);
  const [isLoading, setIsLoading] = useState(cached === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const pendingActionRef = useRef<PendingAgentAction | null>(null);

  const loadAgents = useCallback(async (showLoading = true, force = false) => {
    const requestId = ++loadRequestIdRef.current;
    const isWarm = !force && availabilityCache.getFreshValue("agents", availabilityTtlMs) !== null;
    if (showLoading && !isWarm) setIsLoading(true);
    setLoadError(null);

    try {
      const result = await availabilityCache.load(
        "agents",
        () =>
          loadAgentAvailability(
            () => invoke<AgentConfig[]>("get_available_agents"),
            () => CodexIntegrationService.status(),
          ),
        { ttlMs: availabilityTtlMs, force },
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

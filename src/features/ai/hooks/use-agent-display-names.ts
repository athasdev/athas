import { useMemo } from "react";
import { buildAgentOptions, type AgentOption } from "@/features/ai/services/agent-options";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";

/** "claude-code" reads as "Claude Code" until the catalog has loaded the agent's own name. */
export function formatAgentIdAsName(agentId: string): string {
  return agentId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The agents Athas knows about, from the catalog already loaded for the agent picker, with a name
 * lookup that falls back to a readable form of the id. Does not refresh the catalog.
 */
export function useAgentDisplayNames(): {
  options: AgentOption[];
  getName: (agentId: string) => string;
  getIcon: (agentId: string) => string | null | undefined;
} {
  const agents = useAgentCatalogStore.use.agents();
  const codex = useAgentCatalogStore.use.codex();
  const pendingAction = useAgentCatalogStore.use.pendingAction();
  const currentAgentId = useAIChatStore((state) => state.selectedAgentId);

  return useMemo(() => {
    const options = buildAgentOptions({
      currentAgentId,
      agentConfigs: new Map(agents.data?.map((agent) => [agent.id, agent]) ?? []),
      codexInstalled: codex.data?.installed ?? false,
      pendingAction,
    });
    const byId = new Map(options.map((option) => [option.id as string, option]));
    return {
      options,
      getName: (agentId) => byId.get(agentId)?.name ?? formatAgentIdAsName(agentId),
      getIcon: (agentId) => byId.get(agentId)?.icon,
    };
  }, [agents.data, codex.data, currentAgentId, pendingAction]);
}

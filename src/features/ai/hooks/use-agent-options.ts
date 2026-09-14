import { useEffect, useMemo } from "react";
import { buildAgentOptions } from "@/features/ai/lib/agent-options";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

export function useAgentOptions(currentAgentId: AgentType) {
  const agents = useAgentCatalogStore.use.agents();
  const codex = useAgentCatalogStore.use.codex();
  const pendingAction = useAgentCatalogStore.use.pendingAction();
  const actions = useAgentCatalogStore.use.actions();
  useEffect(() => {
    void actions.refresh();
  }, [actions]);
  const options = useMemo(
    () =>
      buildAgentOptions({
        currentAgentId,
        agentConfigs: new Map(agents.data?.map((agent) => [agent.id, agent]) ?? []),
        codexInstalled: codex.data?.installed ?? false,
        pendingAction,
      }).map((option) => ({
        ...option,
        isChecking: option.id === "codex" ? codex.data === null : agents.data === null,
      })),
    [agents.data, codex.data, currentAgentId, pendingAction],
  );
  return {
    options,
    isLoading: [agents.status, codex.status].some(
      (status) => status === "idle" || status === "loading",
    ),
    loadError: [agents.error, codex.error].filter(Boolean).join("\n") || null,
    refresh: () => actions.refresh(true),
    runAgentAction: actions.runAgentAction,
  };
}

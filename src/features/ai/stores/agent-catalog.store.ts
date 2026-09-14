import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { toast } from "sonner";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import type { CodexIntegrationStatus } from "@/features/ai/integrations/codex/codex-types";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import {
  getAgentErrorMessage,
  type AgentAction,
  type PendingAgentAction,
} from "@/features/ai/lib/agent-options";
import { withAgentRequestTimeout } from "@/features/ai/lib/agent-request-timeout";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import { createSelectors } from "@/utils/zustand-selectors";

type LoadStatus = "idle" | "loading" | "ready" | "error";
interface CatalogSource<T> {
  data: T | null;
  status: LoadStatus;
  error: string | null;
  updatedAt: number;
}
interface AgentCatalogState {
  agents: CatalogSource<AgentConfig[]>;
  codex: CatalogSource<CodexIntegrationStatus>;
  pendingAction: PendingAgentAction | null;
  actions: {
    refresh: (force?: boolean) => Promise<void>;
    refreshCodex: (force?: boolean) => Promise<void>;
    runAgentAction: (agentId: string, agentName: string, action: AgentAction) => Promise<void>;
  };
}
const emptySource = <T>(): CatalogSource<T> => ({
  data: null,
  status: "idle",
  error: null,
  updatedAt: 0,
});

export const useAgentCatalogStore = createSelectors(
  create<AgentCatalogState>((set, get) => {
    const requests = new Map<string, Promise<void>>();
    function load<K extends "agents" | "codex">(
      key: K,
      loader: () => Promise<NonNullable<AgentCatalogState[K]["data"]>>,
      force = false,
    ): Promise<void> {
      const pending = requests.get(key);
      if (pending) return pending;
      const source = get()[key];
      if (!force && source.status === "ready" && Date.now() - source.updatedAt < 30_000)
        return Promise.resolve();
      set({ [key]: { ...source, status: "loading", error: null } });
      const request = withAgentRequestTimeout(
        Promise.resolve().then(loader),
        key === "codex" ? "Codex discovery" : "Agent discovery",
      )
        .then((data) => {
          set({ [key]: { data, status: "ready", error: null, updatedAt: Date.now() } });
        })
        .catch((error) => {
          set({ [key]: { ...get()[key], status: "error", error: getAgentErrorMessage(error) } });
        })
        .finally(() => {
          requests.delete(key);
        });
      requests.set(key, request);
      return request;
    }
    const refreshCodex = (force = false) =>
      load("codex", () => CodexIntegrationService.status(), force);
    const refreshAgents = (force = false) =>
      load("agents", () => invoke<AgentConfig[]>("get_available_agents"), force);
    return {
      agents: emptySource(),
      codex: emptySource(),
      pendingAction: null,
      actions: {
        refreshCodex,
        refresh: async (force = false) => {
          await Promise.all([refreshAgents(force), refreshCodex(force)]);
        },
        runAgentAction: async (agentId, agentName, action) => {
          if (agentId === "custom" || agentId === CODEX_INTEGRATION_ID || get().pendingAction)
            return;
          set({ pendingAction: { agentId, action } });
          try {
            const updated = await invoke<AgentConfig>(
              action === "update" ? "update_acp_agent" : "install_acp_agent",
              { agentId },
            );
            const source = get().agents;
            set({
              agents: {
                ...source,
                data: [...(source.data ?? []).filter((agent) => agent.id !== updated.id), updated],
              },
            });
            toast.success(`${agentName} ${action === "update" ? "updated" : "installed"}`);
          } catch (error) {
            toast.error(`Failed to ${action} ${agentName}`, {
              description: getAgentErrorMessage(error),
            });
          } finally {
            set({ pendingAction: null });
            await refreshAgents(true);
          }
        },
      },
    };
  }),
);

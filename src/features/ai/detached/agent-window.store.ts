import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { AgentAccountIdentity } from "./agent-window-state";

export const useAgentWindowStore = createSelectors(
  create<{
    accountIdentity: AgentAccountIdentity | null;
    sessions: Record<string, "opening" | "detached">;
    actions: {
      setAccountIdentity: (identity: AgentAccountIdentity | null) => void;
      setStatus: (chatId: string, status: "attached" | "opening" | "detached") => void;
    };
  }>((set) => ({
    accountIdentity: null,
    sessions: {},
    actions: {
      setAccountIdentity: (accountIdentity) => set({ accountIdentity }),
      setStatus: (chatId, status) =>
        set((state) => {
          const sessions = { ...state.sessions };
          if (status === "attached") delete sessions[chatId];
          else sessions[chatId] = status;
          return { sessions };
        }),
    },
  })),
);

export function agentsAreDetached() {
  return Object.keys(useAgentWindowStore.getState().sessions).length > 0;
}

export function agentIsDetached(chatId?: string | null) {
  return Boolean(chatId && useAgentWindowStore.getState().sessions[chatId]);
}

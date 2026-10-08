import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export const useAgentWindowStore = createSelectors(
  create<{
    sessions: Record<string, "opening" | "detached">;
    actions: {
      setStatus: (chatId: string, status: "attached" | "opening" | "detached") => void;
    };
  }>((set) => ({
    sessions: {},
    actions: {
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

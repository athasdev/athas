import { create } from "zustand";

interface AgentAttentionState {
  /** Unanswered permission prompts per chat id. */
  pendingPermissions: Record<string, number>;
  actions: {
    setPendingPermissions: (chatId: string, count: number) => void;
  };
}

/** What each chat is waiting on the user for, for tabs and lists that do not show the chat. */
export const useAgentAttentionStore = create<AgentAttentionState>()((set) => ({
  pendingPermissions: {},
  actions: {
    setPendingPermissions: (chatId, count) =>
      set((state) => {
        if ((state.pendingPermissions[chatId] ?? 0) === count) return state;
        const pendingPermissions = { ...state.pendingPermissions };
        if (count > 0) pendingPermissions[chatId] = count;
        else delete pendingPermissions[chatId];
        return { pendingPermissions };
      }),
  },
}));

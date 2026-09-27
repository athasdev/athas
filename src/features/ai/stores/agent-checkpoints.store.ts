import { create } from "zustand";
import { EMPTY_CHAT_CHECKPOINTS } from "@/features/ai/lib/agent-edit-checkpoints";
import type { ChatCheckpoints } from "@/features/ai/types/agent-checkpoints.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface AgentCheckpointsState {
  /** Each loaded chat's checkpoints, by chat id. A chat missing here has not been loaded. */
  byChat: Record<string, ChatCheckpoints>;
  actions: {
    setChatCheckpoints: (chatId: string, checkpoints: ChatCheckpoints) => void;
    forgetChat: (chatId: string) => void;
  };
}

/** Per-turn file snapshots of what each chat's agent changed, so a turn can be undone. */
const useAgentCheckpointsStoreBase = create<AgentCheckpointsState>()((set) => ({
  byChat: {},
  actions: {
    setChatCheckpoints: (chatId, checkpoints) =>
      set((state) => ({ byChat: { ...state.byChat, [chatId]: checkpoints } })),
    forgetChat: (chatId) =>
      set((state) => {
        if (!(chatId in state.byChat)) return state;
        const byChat = { ...state.byChat };
        delete byChat[chatId];
        return { byChat };
      }),
  },
}));

export const useAgentCheckpointsStore = createSelectors(useAgentCheckpointsStoreBase);

export function getChatCheckpoints(chatId: string): ChatCheckpoints {
  return useAgentCheckpointsStore.getState().byChat[chatId] ?? EMPTY_CHAT_CHECKPOINTS;
}

import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

/**
 * Which sessions have their message search open. The search opens from the session's controls in
 * the tab bar as well as from ⌘F inside the conversation, so it lives outside the chat view.
 */
interface ChatMessageSearchState {
  open: Record<string, true>;
  actions: {
    setOpen: (chatId: string, open: boolean) => void;
    toggle: (chatId: string) => void;
  };
}

const useChatMessageSearchStoreBase = create<ChatMessageSearchState>()((set, get) => ({
  open: {},
  actions: {
    setOpen: (chatId, open) =>
      set((state) => {
        if (Boolean(state.open[chatId]) === open) return state;
        const next = { ...state.open };
        if (open) next[chatId] = true;
        else delete next[chatId];
        return { open: next };
      }),
    toggle: (chatId) => get().actions.setOpen(chatId, !get().open[chatId]),
  },
}));

export const useChatMessageSearchStore = createSelectors(useChatMessageSearchStoreBase);

import { create } from "zustand";
import type { AgentEditEntry } from "@/features/ai/types/agent-edits.types";
import { createSelectors } from "@/utils/zustand-selectors";

const NO_ENTRIES: Record<string, AgentEditEntry> = {};

interface AgentEditsState {
  /** Unreviewed agent writes by chat id, then by file path. */
  byChat: Record<string, Record<string, AgentEditEntry>>;
  /** The chat whose review is open, if any. */
  reviewChatId: string | null;
  actions: {
    /** Stores the file's entry, or forgets the file when `entry` is null. */
    setEntry: (chatId: string, path: string, entry: AgentEditEntry | null) => void;
    openReview: (chatId: string) => void;
    closeReview: () => void;
  };
}

/**
 * The action log for agent edits: what each chat's agent wrote through `fs/write_text_file` that
 * the user has not kept or rejected yet. It lives as long as the app does; a chat's log empties
 * as its hunks are resolved.
 */
const useAgentEditsStoreBase = create<AgentEditsState>()((set) => ({
  byChat: {},
  reviewChatId: null,
  actions: {
    setEntry: (chatId, path, entry) =>
      set((state) => {
        const files = { ...state.byChat[chatId] };
        if (entry) files[path] = entry;
        else if (path in files) delete files[path];
        else return state;
        const byChat = { ...state.byChat };
        if (Object.keys(files).length > 0) byChat[chatId] = files;
        else delete byChat[chatId];
        return { byChat };
      }),
    openReview: (chatId) => set({ reviewChatId: chatId }),
    closeReview: () => set({ reviewChatId: null }),
  },
}));

export const useAgentEditsStore = createSelectors(useAgentEditsStoreBase);

export function getAgentEditEntries(chatId: string): Record<string, AgentEditEntry> {
  return useAgentEditsStore.getState().byChat[chatId] ?? NO_ENTRIES;
}

/** The chat's unreviewed files, re-rendering when they change. */
export function useAgentEditEntries(chatId: string | null | undefined) {
  return useAgentEditsStore((state) => (chatId ? state.byChat[chatId] : undefined) ?? NO_ENTRIES);
}

/**
 * The chat an "agent changes" command acts on: `preferred` (the chat in view) when it has
 * unreviewed edits, otherwise the most recently changed chat that does.
 */
export function pickAgentEditsChatId(preferred: string | null | undefined): string | null {
  const { byChat } = useAgentEditsStore.getState();
  if (preferred && byChat[preferred]) return preferred;
  const chatIds = Object.keys(byChat);
  return chatIds[chatIds.length - 1] ?? null;
}

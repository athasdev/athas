import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

/** The pull request a session's branch was last seen open in, so its merge can be noticed. */
export interface SessionPullRequestRecord {
  repoPath: string;
  number: number;
  at: number;
}

const MAX_REMEMBERED = 300;

interface SessionPullRequestsState {
  byChat: Record<string, SessionPullRequestRecord>;
  actions: {
    remember: (chatId: string, repoPath: string, number: number) => void;
    forget: (chatId: string) => void;
  };
}

function rememberRecent(byChat: Record<string, SessionPullRequestRecord>) {
  const entries = Object.entries(byChat);
  if (entries.length <= MAX_REMEMBERED) return byChat;
  return Object.fromEntries(
    entries.sort(([, left], [, right]) => right.at - left.at).slice(0, MAX_REMEMBERED),
  );
}

const useSessionPullRequestsStoreBase = create<SessionPullRequestsState>()(
  persist(
    (set) => ({
      byChat: {},
      actions: {
        remember: (chatId, repoPath, number) =>
          set((state) => {
            const known = state.byChat[chatId];
            if (known?.number === number && known.repoPath === repoPath) return state;
            return { byChat: { ...state.byChat, [chatId]: { repoPath, number, at: Date.now() } } };
          }),
        forget: (chatId) =>
          set((state) => {
            if (!(chatId in state.byChat)) return state;
            const byChat = { ...state.byChat };
            delete byChat[chatId];
            return { byChat };
          }),
      },
    }),
    {
      name: "athas-session-pull-requests-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ byChat: rememberRecent(state.byChat) }),
    },
  ),
);

export const useSessionPullRequestsStore = createSelectors(useSessionPullRequestsStoreBase);

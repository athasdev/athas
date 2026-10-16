import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

/** How an agent session's latest turn ended. */
export type SessionOutcome = "complete" | "error";

export interface SessionOutcomeRecord {
  outcome: SessionOutcome;
  /** The turn ended while the session was not on screen, and the user has not looked since. */
  unread: boolean;
  at: number;
}

const MAX_REMEMBERED_OUTCOMES = 300;

interface SessionInboxState {
  outcomes: Record<string, SessionOutcomeRecord>;
  actions: {
    /** Records how a session's turn ended; `seen` when the session was on screen as it did. */
    recordOutcome: (chatId: string, outcome: SessionOutcome, seen: boolean) => void;
    markRead: (chatId: string) => void;
    forget: (chatId: string) => void;
  };
}

function rememberRecent(outcomes: Record<string, SessionOutcomeRecord>) {
  const entries = Object.entries(outcomes);
  if (entries.length <= MAX_REMEMBERED_OUTCOMES) return outcomes;
  return Object.fromEntries(
    entries.sort(([, left], [, right]) => right.at - left.at).slice(0, MAX_REMEMBERED_OUTCOMES),
  );
}

const useSessionInboxStoreBase = create<SessionInboxState>()(
  persist(
    (set) => ({
      outcomes: {},
      actions: {
        recordOutcome: (chatId, outcome, seen) =>
          set((state) => ({
            outcomes: {
              ...state.outcomes,
              [chatId]: { outcome, unread: !seen, at: Date.now() },
            },
          })),
        markRead: (chatId) =>
          set((state) => {
            const record = state.outcomes[chatId];
            if (!record?.unread) return state;
            return { outcomes: { ...state.outcomes, [chatId]: { ...record, unread: false } } };
          }),
        forget: (chatId) =>
          set((state) => {
            if (!(chatId in state.outcomes)) return state;
            const outcomes = { ...state.outcomes };
            delete outcomes[chatId];
            return { outcomes };
          }),
      },
    }),
    {
      name: "athas-agent-session-inbox-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ outcomes: rememberRecent(state.outcomes) }),
    },
  ),
);

export const useSessionInboxStore = createSelectors(useSessionInboxStoreBase);

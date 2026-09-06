import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type { AgentChangeSession } from "../types/review.types";

/** The shape ACP tool results already carry for a `diff` content block. */
export interface AgentChangeInput {
  path: string;
  oldText: string;
  newText: string;
}

const SESSION_LIMIT = 20;

interface RecordDiffsInput {
  sessionId: string;
  title: string;
  workspacePath: string | null;
  diffs: AgentChangeInput[];
}

interface AgentChangesState {
  sessions: Record<string, AgentChangeSession>;
  actions: {
    recordDiffs: (input: RecordDiffsInput) => void;
    markReviewed: (sessionId: string) => void;
    clearSession: (sessionId: string) => void;
  };
}

function pruneSessions(sessions: Record<string, AgentChangeSession>) {
  const entries = Object.entries(sessions).sort(([, left], [, right]) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return Object.fromEntries(entries.slice(0, SESSION_LIMIT));
}

const useAgentChangesStoreBase = create<AgentChangesState>()((set) => ({
  sessions: {},
  actions: {
    recordDiffs: ({ sessionId, title, workspacePath, diffs }) => {
      if (diffs.length === 0) return;

      set((state) => {
        const now = new Date().toISOString();
        const existing = state.sessions[sessionId];
        const files = { ...existing?.files };

        for (const diff of diffs) {
          const previous = files[diff.path];
          files[diff.path] = {
            path: diff.path,
            // The first text seen for a file is the session's baseline; later
            // edits only move the "after" side forward.
            oldText: previous?.oldText ?? diff.oldText,
            newText: diff.newText,
          };
        }

        const session: AgentChangeSession = {
          sessionId,
          title,
          workspacePath,
          startedAt: existing?.startedAt ?? now,
          updatedAt: now,
          // New edits reopen a session that had already been signed off.
          reviewedAt: null,
          files,
        };

        return { sessions: pruneSessions({ ...state.sessions, [sessionId]: session }) };
      });
    },

    markReviewed: (sessionId) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session || session.reviewedAt) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, reviewedAt: new Date().toISOString() },
          },
        };
      }),

    clearSession: (sessionId) =>
      set((state) => {
        if (!state.sessions[sessionId]) return state;
        const { [sessionId]: _removed, ...rest } = state.sessions;
        return { sessions: rest };
      }),
  },
}));

export const useAgentChangesStore = createSelectors(useAgentChangesStoreBase);

/**
 * Record the file edits an agent reported through an ACP `diff` tool result,
 * so the review sidebar can offer the session as its own change set.
 */
export function recordAgentSessionDiffs(input: RecordDiffsInput): void {
  useAgentChangesStoreBase.getState().actions.recordDiffs(input);
}

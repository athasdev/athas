import { create } from "zustand";
import type { AcpElicitationRequest, AcpElicitationResponse } from "../lib/acp-elicitation";
import { AcpStreamHandler } from "../services/acp-stream-handler";
import { createSelectors } from "@/utils/zustand-selectors";

export interface AcpQuestion {
  requestId: string;
  /** Null for request-scoped questions, which belong to no session. */
  sessionId: string | null;
  /** For a question with no session: the chat that was talking to the agent when it asked. */
  chatId?: string | null;
  request: AcpElicitationRequest;
  /** A URL question the user accepted: the agent is waiting for the flow in the browser. */
  waiting?: boolean;
}

interface AcpQuestionsState {
  questions: AcpQuestion[];
  actions: {
    add: (question: AcpQuestion) => void;
    /** The agent stopped waiting (cancelled, timed out, or went away). */
    remove: (requestId: string) => void;
    /** Accepting a URL question keeps it, marked waiting, until the agent reports completion. */
    answer: (requestId: string, response: AcpElicitationResponse) => Promise<void>;
    /** `elicitation/complete`: the flow behind a URL question finished. Unknown ids are ignored. */
    complete: (elicitationId: string) => void;
    /**
     * Drops a stopped session's URL questions (and request-scoped ones) that wait on a browser
     * flow. Unanswered questions are cancelled by the bridge, which then closes them.
     */
    forgetWaitingForSession: (sessionId: string | null | undefined) => void;
  };
}

/**
 * Questions agents ask through ACP `elicitation/create`. They live outside any one prompt run,
 * because agents also ask between prompts (MCP sign-in right after a session starts). The agent
 * waits on each until it is answered or the bridge reports it closed.
 */
const useAcpQuestionsStoreBase = create<AcpQuestionsState>()((set, get) => ({
  questions: [],
  actions: {
    add: (question) =>
      set((state) =>
        state.questions.some((item) => item.requestId === question.requestId)
          ? state
          : { questions: [...state.questions, question] },
      ),
    remove: (requestId) =>
      set((state) => ({
        questions: state.questions.filter((item) => item.requestId !== requestId),
      })),
    answer: async (requestId, response) => {
      const question = get().questions.find((item) => item.requestId === requestId);
      try {
        await AcpStreamHandler.respondToElicitation(requestId, response);
      } catch (error) {
        get().actions.remove(requestId);
        throw error;
      }
      if (question?.request.mode === "url" && response.action === "accept") {
        set((state) => ({
          questions: state.questions.map((item) =>
            item.requestId === requestId ? { ...item, waiting: true } : item,
          ),
        }));
      } else {
        get().actions.remove(requestId);
      }
    },
    complete: (elicitationId) =>
      set((state) => ({
        questions: state.questions.filter(
          (item) => item.request.mode !== "url" || item.request.elicitationId !== elicitationId,
        ),
      })),
    forgetWaitingForSession: (sessionId) => {
      for (const question of get().questions) {
        if (question.sessionId !== null && question.sessionId !== sessionId) continue;
        if (question.waiting) get().actions.remove(question.requestId);
      }
    },
  },
}));

export const useAcpQuestionsStore = createSelectors(useAcpQuestionsStoreBase);

/**
 * The questions a chat on `sessionId` should show: its own and request-scoped ones, with those
 * still waiting on an answer ahead of URL flows already opened in the browser.
 */
export function selectSessionQuestions(questions: AcpQuestion[], sessionId: string | null) {
  const own = questions.filter(
    (question) => question.sessionId === null || question.sessionId === sessionId,
  );
  return [...own.filter((question) => !question.waiting), ...own.filter((q) => q.waiting)];
}

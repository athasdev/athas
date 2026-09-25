import { create } from "zustand";
import type { AcpElicitationRequest, AcpElicitationResponse } from "../lib/acp-elicitation";
import { AcpStreamHandler } from "../services/acp-stream-handler";
import { createSelectors } from "@/utils/zustand-selectors";

export interface AcpQuestion {
  requestId: string;
  /** Null for request-scoped questions, which belong to no session. */
  sessionId: string | null;
  request: AcpElicitationRequest;
}

interface AcpQuestionsState {
  questions: AcpQuestion[];
  actions: {
    add: (question: AcpQuestion) => void;
    /** The agent stopped waiting (cancelled, timed out, or went away). */
    remove: (requestId: string) => void;
    answer: (requestId: string, response: AcpElicitationResponse) => Promise<void>;
    /** Cancels every question a session is waiting on, plus request-scoped ones. */
    cancelForSession: (sessionId: string | null | undefined) => void;
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
      try {
        await AcpStreamHandler.respondToElicitation(requestId, response);
      } finally {
        get().actions.remove(requestId);
      }
    },
    cancelForSession: (sessionId) => {
      for (const question of get().questions) {
        if (question.sessionId !== null && question.sessionId !== sessionId) continue;
        void get()
          .actions.answer(question.requestId, { action: "cancel" })
          .catch(() => undefined);
      }
    },
  },
}));

export const useAcpQuestionsStore = createSelectors(useAcpQuestionsStoreBase);

/** The questions a chat on `sessionId` should show: its own and request-scoped ones. */
export function selectSessionQuestions(questions: AcpQuestion[], sessionId: string | null) {
  return questions.filter(
    (question) => question.sessionId === null || question.sessionId === sessionId,
  );
}

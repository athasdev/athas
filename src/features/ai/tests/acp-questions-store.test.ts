import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  type AcpQuestion,
  selectSessionQuestions,
  useAcpQuestionsStore,
} from "@/features/ai/stores/acp-questions.store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

function question(requestId: string, sessionId: string | null): AcpQuestion {
  return {
    requestId,
    sessionId,
    request: {
      mode: "form",
      message: "Which scope?",
      requestedSchema: { type: "object", properties: {} },
    },
  };
}

const { actions } = useAcpQuestionsStore.getState();
const requestIds = () => useAcpQuestionsStore.getState().questions.map((item) => item.requestId);

describe("agent question store", () => {
  beforeEach(() => {
    useAcpQuestionsStore.setState({ questions: [] });
    vi.mocked(invoke).mockReset();
  });

  it("queues each question once and drops ones the agent closed", () => {
    actions.add(question("q1", "session-a"));
    actions.add(question("q1", "session-a"));
    actions.add(question("q2", null));
    expect(requestIds()).toEqual(["q1", "q2"]);

    actions.remove("q1");
    expect(requestIds()).toEqual(["q2"]);
  });

  it("shows a chat its own session's questions and request-scoped ones", () => {
    const questions = [question("a", "session-a"), question("b", "session-b"), question("n", null)];
    expect(selectSessionQuestions(questions, "session-a").map((item) => item.requestId)).toEqual([
      "a",
      "n",
    ]);
  });

  it("forgets a question once answered, even if the agent stopped waiting", async () => {
    actions.add(question("q1", "session-a"));
    vi.mocked(invoke).mockRejectedValueOnce("The agent is no longer waiting for this answer");

    await expect(actions.answer("q1", { action: "decline" })).rejects.toBeDefined();
    expect(requestIds()).toEqual([]);
  });

  it("cancels a stopped session's questions and leaves other sessions alone", () => {
    actions.add(question("a", "session-a"));
    actions.add(question("b", "session-b"));
    actions.add(question("n", null));

    actions.cancelForSession("session-a");

    const cancelled = vi.mocked(invoke).mock.calls.map(([, args]) => args);
    expect(cancelled).toEqual([
      { requestId: "a", response: { action: "cancel" } },
      { requestId: "n", response: { action: "cancel" } },
    ]);
  });
});

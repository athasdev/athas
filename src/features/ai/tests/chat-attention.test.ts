import { describe, expect, it } from "vite-plus/test";
import { getChatAttention } from "@/features/ai/lib/chat-attention";
import type { AcpAuthRequest } from "@/features/ai/stores/acp-auth.store";
import type { AcpQuestion } from "@/features/ai/stores/acp-questions.store";

function question(
  sessionId: string | null,
  waiting = false,
  chatId: string | null = null,
): AcpQuestion {
  return {
    requestId: `q-${sessionId}`,
    sessionId,
    chatId,
    request: { message: "Pick one" } as AcpQuestion["request"],
    waiting,
  };
}

function authRequest(
  sessionId: string | null,
  phase: AcpAuthRequest["phase"],
  chatId: string | null = null,
): AcpAuthRequest {
  return {
    agentId: "agent",
    sessionId,
    chatId,
    methods: [],
    phase,
    activeMethodId: null,
    error: null,
  };
}

const idle = {
  chatId: "chat-1",
  sessionId: "s1",
  pendingPermissions: 0,
  questions: [],
  authRequest: null,
};

describe("getChatAttention", () => {
  it("is null for a chat that is not waiting on the user", () => {
    expect(getChatAttention(idle)).toBeNull();
  });

  it("puts a pending permission first", () => {
    expect(
      getChatAttention({
        ...idle,
        pendingPermissions: 1,
        questions: [question("s1")],
        authRequest: authRequest("s1", "choosing"),
      }),
    ).toBe("permission");
  });

  it("counts only questions of the chat's own session that still need an answer", () => {
    expect(getChatAttention({ ...idle, questions: [question("s1")] })).toBe("question");
    expect(getChatAttention({ ...idle, questions: [question("s2")] })).toBeNull();
    expect(getChatAttention({ ...idle, questions: [question(null)] })).toBeNull();
    expect(getChatAttention({ ...idle, questions: [question("s1", true)] })).toBeNull();
  });

  it("marks a sign-in only while the user still has to pick a method", () => {
    expect(getChatAttention({ ...idle, authRequest: authRequest("s1", "choosing") })).toBe("auth");
    expect(getChatAttention({ ...idle, authRequest: authRequest("s1", "signing_in") })).toBeNull();
    expect(getChatAttention({ ...idle, authRequest: authRequest("s2", "choosing") })).toBeNull();
  });

  it("gives prompts with no session to the chat they were routed to", () => {
    const starting = { ...idle, sessionId: null };
    expect(
      getChatAttention({ ...starting, authRequest: authRequest(null, "choosing", "chat-1") }),
    ).toBe("auth");
    expect(
      getChatAttention({ ...starting, authRequest: authRequest(null, "choosing", "chat-2") }),
    ).toBeNull();
    expect(getChatAttention({ ...idle, questions: [question(null, false, "chat-1")] })).toBe(
      "question",
    );
  });

  it("ignores session-bound prompts for a chat with no session yet", () => {
    expect(
      getChatAttention({
        ...idle,
        sessionId: null,
        questions: [question(null)],
        authRequest: authRequest(null, "choosing"),
      }),
    ).toBeNull();
  });
});

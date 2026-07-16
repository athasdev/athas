import { describe, expect, it } from "vite-plus/test";
import { buildConversationHistory } from "@/features/ai/lib/conversation-history";
import type { Message } from "@/features/ai/types/ai-chat.types";

function message(overrides: Partial<Message>): Message {
  return {
    id: "message",
    content: "content",
    role: "user",
    timestamp: new Date(0),
    ...overrides,
  };
}

describe("buildConversationHistory", () => {
  it("keeps only completed visible user and assistant turns", () => {
    expect(
      buildConversationHistory([
        message({ role: "system", content: "system prompt" }),
        message({ id: "user-1", content: "First question" }),
        message({ id: "assistant-1", role: "assistant", content: "First answer" }),
        message({ id: "stale-empty", role: "assistant", content: "" }),
        message({
          id: "current-assistant",
          role: "assistant",
          content: "Partial answer",
          isStreaming: true,
        }),
      ]),
    ).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ]);
  });
});

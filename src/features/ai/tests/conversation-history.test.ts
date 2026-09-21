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
  it("recovers persisted tool-only turns without replaying interrupted actions", () => {
    const history = buildConversationHistory([
      message({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            name: "edit_file",
            input: { path: "file.ts" },
            output: { applied: true },
            isComplete: true,
            timestamp: new Date(0),
          },
          { name: "run_command", input: { command: "bun test" }, timestamp: new Date(0) },
        ],
      }),
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].content).toContain("applied");
    expect(history[0].content).toContain("interrupted; verify current state before retrying");
  });
  it("retains images and image-only user messages in subsequent requests", () => {
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    expect(buildConversationHistory([message({ content: "", images })])).toEqual([
      { role: "user", content: "", images },
    ]);
  });

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

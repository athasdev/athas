import { describe, expect, it } from "vite-plus/test";
import {
  coalesceAssistantResponses,
  startAssistantResponseContinuation,
} from "@/features/ai/lib/assistant-response";
import type { Message } from "@/features/ai/types/ai-chat.types";

function message(overrides: Partial<Message>): Message {
  return {
    id: "message-1",
    content: "",
    role: "assistant",
    timestamp: new Date(0),
    ...overrides,
  };
}

describe("assistant responses", () => {
  it("starts continuation text without creating extra leading whitespace", () => {
    expect(startAssistantResponseContinuation("")).toBe("");
    expect(startAssistantResponseContinuation("First part   ")).toBe("First part\n\n");
  });

  it("coalesces consecutive assistant segments into one turn", () => {
    const toolCall = {
      id: "tool-1",
      name: "read_file",
      input: {},
      timestamp: new Date(1),
    };
    const messages = coalesceAssistantResponses([
      message({ id: "user-1", role: "user", content: "Review this" }),
      message({ id: "assistant-1", content: "I’ll inspect it.", toolCalls: [toolCall] }),
      message({
        id: "assistant-2",
        content: "The result looks good.",
        timestamp: new Date(2),
        isStreaming: false,
      }),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: "assistant-1",
      content: "I’ll inspect it.\n\nThe result looks good.",
      timestamp: new Date(2),
      toolCalls: [toolCall],
    });
  });

  it("keeps separate assistant turns across a user message", () => {
    const messages = coalesceAssistantResponses([
      message({ id: "assistant-1", content: "First" }),
      message({ id: "user-1", role: "user", content: "Continue" }),
      message({ id: "assistant-2", content: "Second" }),
    ]);

    expect(messages.map((item) => item.id)).toEqual(["assistant-1", "user-1", "assistant-2"]);
  });
});

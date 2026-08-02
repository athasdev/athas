import { describe, expect, it } from "vite-plus/test";
import {
  getFallbackAgentSessionTitle,
  normalizeAgentSessionTitle,
} from "@/features/ai/utils/chat-session-title";
import { getMessageSearchMatches } from "@/features/ai/utils/message-search";
import type { Message } from "@/features/ai/types/ai-chat.types";

function createMessage(id: string, content: string): Message {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date(0),
  };
}

describe("chat presentation utilities", () => {
  it("normalizes generated session titles to two plain words", () => {
    expect(normalizeAgentSessionTitle("`Project search!` extra")).toBe("Project search");
    expect(normalizeAgentSessionTitle("...")).toBeNull();
  });

  it("caps fallback session titles", () => {
    const message = "a".repeat(60);
    expect(getFallbackAgentSessionTitle(message)).toBe(`${"a".repeat(50)}...`);
  });

  it("returns every case-insensitive message search match in order", () => {
    const messages = [
      createMessage("first", "Agent agent"),
      createMessage("second", "No match"),
      createMessage("third", "AGENT"),
    ];

    expect(getMessageSearchMatches(messages, "agent")).toEqual([
      { messageId: "first" },
      { messageId: "first" },
      { messageId: "third" },
    ]);
  });
});

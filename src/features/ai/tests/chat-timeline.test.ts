import { describe, expect, it } from "vite-plus/test";
import { buildChatTimeline } from "@/features/ai/lib/chat-timeline";
import type { Message } from "@/features/ai/types/ai-chat.types";

const message = (id: string, role: Message["role"], ms: number): Message => ({
  id,
  role,
  content: id,
  timestamp: new Date(ms),
});

describe("chat timeline", () => {
  it("keeps an edited prompt above its answer even though it was re-stamped later", () => {
    const items = buildChatTimeline([message("q", "user", 5000), message("a", "assistant", 1000)]);

    expect(items.map((item) => item.id)).toEqual(["message-q", "message-a"]);
  });

  it("slots agent events between messages by time", () => {
    const items = buildChatTimeline(
      [message("q", "user", 1000), message("a", "assistant", 3000)],
      [
        { id: "plan", category: "plan", label: "Plan", timestamp: new Date(2000) },
        { id: "late", category: "status", label: "Late", timestamp: new Date(4000) },
      ],
    );

    expect(items.map((item) => item.id)).toEqual([
      "message-q",
      "acp-plan",
      "message-a",
      "acp-late",
    ]);
  });
});

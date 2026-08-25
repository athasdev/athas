import { describe, expect, it } from "vite-plus/test";
import { normalizeCodexThreadMessages } from "@/features/ai/integrations/codex/codex-thread-history";

describe("Codex thread history", () => {
  it("normalizes user and assistant messages from thread turns", () => {
    const messages = normalizeCodexThreadMessages({
      thread: {
        createdAt: 1_700_000_000,
        turns: [
          {
            startedAt: 1_700_000_001,
            completedAt: 1_700_000_002,
            items: [
              {
                type: "userMessage",
                id: "user-1",
                content: [
                  { type: "text", text: "Review this" },
                  { type: "localImage", path: "/tmp/screenshot.png" },
                ],
              },
              { type: "reasoning", id: "reasoning-1", summary: ["Checking"] },
              { type: "agentMessage", id: "assistant-1", text: "Looks good" },
            ],
          },
        ],
      },
    });

    expect(messages).toEqual([
      {
        id: "user-1",
        content: "Review this",
        role: "user",
        timestamp: new Date(1_700_000_001_000),
      },
      {
        id: "assistant-1",
        content: "Looks good",
        role: "assistant",
        timestamp: new Date(1_700_000_002_000),
      },
    ]);
  });

  it("returns an empty transcript for a thread without turns", () => {
    expect(normalizeCodexThreadMessages({ thread: { turns: [] } })).toEqual([]);
  });
});

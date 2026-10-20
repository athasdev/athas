import { describe, expect, it } from "vite-plus/test";
import { codexThreadToMessages } from "@/features/ai/integrations/codex/codex-thread-history";

const ids = () => {
  let next = 0;
  return () => `m${++next}`;
};

describe("Codex thread history", () => {
  it("keeps user messages and joins a turn's agent messages into one answer", () => {
    const messages = codexThreadToMessages(
      {
        thread: {
          createdAt: 100,
          turns: [
            {
              startedAt: 200,
              completedAt: 260,
              items: [
                {
                  type: "userMessage",
                  content: [
                    { type: "text", text: "Fix the build" },
                    { type: "image", url: "data:image/png;base64,AA" },
                  ],
                },
                { type: "reasoning", summary: [] },
                { type: "agentMessage", text: "Looking at it." },
                { type: "commandExecution", command: "bun test" },
                { type: "agentMessage", text: "Fixed." },
              ],
            },
            { startedAt: 300, completedAt: null, items: [{ type: "agentMessage", text: "" }] },
          ],
        },
      },
      ids(),
    );

    expect(messages).toEqual([
      { id: "m1", role: "user", content: "Fix the build", timestamp: new Date(200_000) },
      {
        id: "m2",
        role: "assistant",
        content: "Looking at it.\n\nFixed.",
        timestamp: new Date(260_000),
      },
    ]);
  });

  it("returns no messages for an answer without turns", () => {
    expect(codexThreadToMessages({ thread: { id: "t1" } })).toEqual([]);
    expect(codexThreadToMessages(null)).toEqual([]);
  });
});

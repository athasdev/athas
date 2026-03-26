import { describe, expect, test } from "bun:test";
import {
  buildConversationHistory,
  createSummaryMessage,
  getBranchDeltaMessages,
  getEffectiveChatMessages,
  prepareChatCompaction,
} from "./chat-context";

describe("chat context helpers", () => {
  test("builds effective messages from the latest compaction summary", () => {
    const messages = [
      {
        id: "m1",
        lineageMessageId: "m1",
        role: "user" as const,
        content: "first",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "m2",
        lineageMessageId: "m2",
        role: "assistant" as const,
        content: "second",
        timestamp: new Date("2026-01-01T00:00:01.000Z"),
      },
      {
        id: "m3",
        lineageMessageId: "m3",
        role: "user" as const,
        content: "third",
        timestamp: new Date("2026-01-01T00:00:02.000Z"),
      },
      createSummaryMessage("compaction-summary", "checkpoint", {
        type: "compaction",
        firstKeptLineageMessageId: "m2",
        tokensBefore: 123,
        trigger: "manual",
      }),
      {
        id: "m4",
        lineageMessageId: "m4",
        role: "assistant" as const,
        content: "after",
        timestamp: new Date("2026-01-01T00:00:03.000Z"),
      },
    ];

    expect(getEffectiveChatMessages({ messages }).map((message) => message.content)).toEqual([
      "checkpoint",
      "second",
      "third",
      "after",
    ]);

    expect(buildConversationHistory({ messages }).map((message) => message.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  test("computes branch delta messages from the shared lineage prefix", () => {
    const targetChat = {
      rootChatId: "root",
      messages: [
        {
          id: "m1-target",
          lineageMessageId: "m1",
          role: "user" as const,
          content: "shared-1",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "m2-target",
          lineageMessageId: "m2",
          role: "assistant" as const,
          content: "shared-2",
          timestamp: new Date("2026-01-01T00:00:01.000Z"),
        },
      ],
    };
    const sourceChat = {
      rootChatId: "root",
      messages: [
        ...targetChat.messages,
        {
          id: "m3-source",
          lineageMessageId: "m3",
          role: "user" as const,
          content: "branch-only",
          timestamp: new Date("2026-01-01T00:00:02.000Z"),
        },
      ],
    };

    expect(getBranchDeltaMessages(sourceChat, targetChat)).toEqual({
      commonAncestorLineageMessageId: "m2",
      sourceLastLineageMessageId: "m3",
      messages: [
        {
          id: "m3-source",
          lineageMessageId: "m3",
          role: "user",
          content: "branch-only",
          timestamp: new Date("2026-01-01T00:00:02.000Z"),
          kind: "default",
          summaryMeta: undefined,
          toolCalls: undefined,
          images: undefined,
          resources: undefined,
        },
      ],
    });
  });

  test("prepares compaction plans when forced", () => {
    const chat = {
      messages: [
        {
          id: "m1",
          lineageMessageId: "m1",
          role: "user" as const,
          content: "a".repeat(200),
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "m2",
          lineageMessageId: "m2",
          role: "assistant" as const,
          content: "b".repeat(200),
          timestamp: new Date("2026-01-01T00:00:01.000Z"),
        },
        {
          id: "m3",
          lineageMessageId: "m3",
          role: "user" as const,
          content: "c".repeat(200),
          timestamp: new Date("2026-01-01T00:00:02.000Z"),
        },
      ],
    };

    const plan = prepareChatCompaction(chat, 1, 0, 50, true);
    expect(plan?.firstKeptLineageMessageId).toBe("m3");
    expect(plan?.messagesToSummarize.map((message) => message.lineageMessageId)).toEqual([
      "m1",
      "m2",
    ]);
  });
});

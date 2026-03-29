import { describe, expect, test } from "bun:test";
import {
  cloneMessagesForFork,
  createForkedChatLineage,
  createRootChatLineage,
  getChatLineageLabel,
  getChatLineagePath,
} from "./chat-lineage";

describe("chat lineage helpers", () => {
  test("creates root lineage metadata", () => {
    expect(createRootChatLineage("harness:session:1")).toEqual({
      parentChatId: null,
      rootChatId: "harness:session:1",
      branchPointMessageId: null,
      lineageDepth: 0,
      sessionName: null,
    });
  });

  test("creates forked lineage metadata from a source chat", () => {
    expect(
      createForkedChatLineage(
        {
          id: "source-chat",
          rootChatId: "root-chat",
          lineageDepth: 1,
          sessionName: "Debug Session",
          title: "Fix the bug",
        },
        "message-3",
      ),
    ).toEqual({
      parentChatId: "source-chat",
      rootChatId: "root-chat",
      branchPointMessageId: "message-3",
      lineageDepth: 2,
      sessionName: "Debug Session",
    });
  });

  test("clones forked messages with fresh ids and detached tool call references", () => {
    const originalInput = { path: "/tmp/file.ts" };
    const originalOutput = { ok: true };
    const clonedMessages = cloneMessagesForFork([
      {
        id: "message-1",
        lineageMessageId: "lineage-1",
        role: "assistant",
        content: "done",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        toolCalls: [
          {
            name: "readFile",
            input: originalInput,
            output: originalOutput,
            timestamp: new Date("2026-01-01T00:00:01.000Z"),
          },
        ],
      },
    ]);

    expect(clonedMessages[0].id).not.toBe("message-1");
    expect(clonedMessages[0].lineageMessageId).toBe("lineage-1");
    expect(clonedMessages[0].toolCalls?.[0].input).toEqual({ path: "/tmp/file.ts" });
    expect(clonedMessages[0].toolCalls?.[0].input).not.toBe(originalInput);
    expect(clonedMessages[0].toolCalls?.[0].output).not.toBe(originalOutput);
  });

  test("labels root and child chats", () => {
    expect(getChatLineageLabel({ lineageDepth: 0 })).toBe("Root");
    expect(getChatLineageLabel({ lineageDepth: 1 })).toBe("Child");
  });

  test("builds a lineage path from root to current chat", () => {
    expect(
      getChatLineagePath(
        [
          { id: "root", parentChatId: null },
          { id: "child", parentChatId: "root" },
          { id: "leaf", parentChatId: "child" },
        ],
        "leaf",
      ),
    ).toEqual(["root", "child", "leaf"]);
  });
});

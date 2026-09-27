import { describe, expect, it } from "vite-plus/test";
import {
  buildConversationHistory,
  compactConversationHistory,
  fitMessagesToProviderLimits,
  getProviderRequestLimits,
  HOSTED_ATHAS_REQUEST_LIMITS,
  HOSTED_ATHAS_TOOL_LOOP_RESERVE,
  providerAcceptsImages,
} from "@/features/ai/lib/conversation-history";
import type { AIMessage } from "@/features/ai/types/messages.types";
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

  it("leaves error cards out of the history the model sees", () => {
    expect(
      buildConversationHistory([
        message({ id: "user-1", content: "Question" }),
        message({
          id: "failed",
          role: "assistant",
          content: "[ERROR_BLOCK]\ntitle: Failed\nmessage: 401\n[/ERROR_BLOCK]",
        }),
        message({
          id: "partial",
          role: "assistant",
          content: "Partial answer\n\n[ERROR_BLOCK]\ntitle: Connection Lost\n[/ERROR_BLOCK]",
        }),
        {
          ...message({ id: "structured", role: "assistant", content: "Rate limited" }),
          error: "429",
        } as Message,
      ]),
    ).toEqual([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Partial answer" },
    ]);
  });

  it("replays short tool summaries instead of file contents", () => {
    const [entry] = buildConversationHistory([
      message({
        role: "assistant",
        content: "Done",
        toolCalls: [
          {
            name: "read_file",
            input: { path: "big.ts" },
            output: { path: "big.ts", totalLines: 900, text: "x".repeat(12_000) },
            isComplete: true,
            timestamp: new Date(0),
          },
          {
            name: "run_command",
            input: { command: "bun test" },
            output: `${"noise ".repeat(2_000)}FAILED: 3 tests`,
            isComplete: true,
            timestamp: new Date(0),
          },
        ],
      }),
    ]);
    expect(entry.content).toContain("read big.ts (900 lines); contents omitted");
    expect(entry.content).toContain("FAILED: 3 tests");
    expect(entry.content).not.toContain("x".repeat(100));
    expect(entry.content.length).toBeLessThan(5_000);
  });

  it("summarises older turns once the history passes the threshold", async () => {
    const history: AIMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn ${index} ${"word ".repeat(200)}`,
    }));
    const summarize = async (older: AIMessage[]) => `model summary of ${older.length}`;

    const compacted = await compactConversationHistory(history, {
      thresholdTokens: 1_000,
      keepRecentTokens: 800,
      summarize,
    });

    expect(compacted.length).toBeLessThan(history.length);
    expect(compacted[0].role).toBe("user");
    expect(compacted[0].content).toMatch(/^\[Summary of \d+ earlier messages/);
    expect(compacted[0].content).toContain("model summary of");
    expect(compacted[compacted.length - 1]).toEqual(history[history.length - 1]);
    expect(await compactConversationHistory(history.slice(0, 2))).toEqual(history.slice(0, 2));
  });

  it("falls back to an extractive summary when the summarizer fails", async () => {
    const history: AIMessage[] = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `request ${index} ${"word ".repeat(200)}`,
    }));
    const compacted = await compactConversationHistory(history, {
      thresholdTokens: 500,
      keepRecentTokens: 400,
      summarize: () => {
        throw new Error("offline");
      },
    });
    expect(compacted[0].content).toContain("- User: request 0");
  });

  it("keeps hosted Athas requests under its message and size limits", () => {
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    const messages: AIMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 150 }, (_, index): AIMessage =>
        index % 2 === 0
          ? { role: "user", content: `question ${index} ${"q".repeat(3_000)}`, images }
          : { role: "assistant", content: `answer ${index} ${"a".repeat(3_000)}` },
      ),
      { role: "user", content: "latest", images },
    ];

    const fitted = fitMessagesToProviderLimits(messages, "athas");
    const bytes = new TextEncoder().encode(JSON.stringify(fitted)).length;

    const loopMessages = HOSTED_ATHAS_TOOL_LOOP_RESERVE.messages;
    expect(fitted.length + loopMessages).toBeLessThanOrEqual(
      HOSTED_ATHAS_REQUEST_LIMITS.maxMessages,
    );
    expect(bytes + HOSTED_ATHAS_TOOL_LOOP_RESERVE.bytes).toBeLessThanOrEqual(
      HOSTED_ATHAS_REQUEST_LIMITS.maxBytes,
    );
    expect(getProviderRequestLimits("athas")?.maxMessages).toBe(40);
    expect(fitted[0]).toEqual({ role: "system", content: "system" });
    expect(fitted[fitted.length - 1].content).toContain("latest");
    expect(fitted.some((entry) => entry.role === "user" && entry.images)).toBe(false);
    expect(fitted[1].content).toMatch(/^\[Summary of \d+ earlier messages/);
  });

  it("truncates a single oversized message for hosted Athas", () => {
    const fitted = fitMessagesToProviderLimits(
      [
        { role: "system", content: "s".repeat(250_000) },
        { role: "user", content: "u".repeat(250_000) },
      ],
      "athas",
    );
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(
      getProviderRequestLimits("athas")?.maxBytes ?? 0,
    );
    expect(fitted.every((entry) => entry.content.length <= 100_000)).toBe(true);
  });

  it("leaves requests to other providers untouched", () => {
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    const messages: AIMessage[] = [{ role: "user", content: "x".repeat(300_000), images }];
    expect(fitMessagesToProviderLimits(messages, "anthropic")).toBe(messages);
    expect(providerAcceptsImages("anthropic")).toBe(true);
    expect(providerAcceptsImages("athas")).toBe(false);
  });
});

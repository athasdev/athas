import { describe, expect, test } from "bun:test";
import {
  formatStreamErrorBlock,
  getStreamErrorInfo,
  getStreamRetryDelayMs,
  shouldAutoRetryStreamError,
} from "./chat-stream-retry";

describe("chat stream retry helpers", () => {
  test("marks rate limits retryable", () => {
    const error = getStreamErrorInfo("OpenAI API error: 429|||{}");

    expect(error).toMatchObject({
      title: "Rate Limit Exceeded",
      code: "429",
      retryable: true,
    });
  });

  test("marks reconnect errors retryable", () => {
    const error = getStreamErrorInfo(
      "Agent disconnected unexpectedly. Click retry to restart.",
      true,
    );

    expect(error).toMatchObject({
      title: "Connection Lost",
      code: "RECONNECT",
      retryable: true,
    });
  });

  test("blocks auto retry after tool activity", () => {
    const error = getStreamErrorInfo("OpenAI API error: 503|||{}");

    expect(
      shouldAutoRetryStreamError({
        error,
        attempt: 1,
        maxAttempts: 2,
        hasToolCalls: true,
        pendingPermissionCount: 0,
      }),
    ).toBe(false);
  });

  test("formats error blocks and computes retry delay", () => {
    const error = getStreamErrorInfo("Failed to connect to openai API: socket hang up");

    expect(formatStreamErrorBlock(error)).toContain("[ERROR_BLOCK]");
    expect(getStreamRetryDelayMs(1)).toBe(1000);
    expect(getStreamRetryDelayMs(3)).toBe(4000);
  });

  test("normalizes multi-line JSON details to single line in error block", () => {
    const multiLineBody = JSON.stringify(
      { error: { code: 429, message: "Resource exhausted.", status: "RESOURCE_EXHAUSTED" } },
      null,
      2,
    );
    const error = getStreamErrorInfo(`Google Gemini API error: 429|||${multiLineBody}`);
    const block = formatStreamErrorBlock(error);

    const lines = block.split("\n");
    const detailsLineIdx = lines.findIndex((l) => l.startsWith("details:"));
    expect(detailsLineIdx).toBeGreaterThan(-1);
    // All JSON content must be on the same line as "details:" (no embedded newlines)
    const detailsValue = lines[detailsLineIdx]!.replace("details:", "").trim();
    expect(() => JSON.parse(detailsValue)).not.toThrow();
    // The next line should be the closing tag, not more JSON
    expect(lines[detailsLineIdx + 1]).toBe("[/ERROR_BLOCK]");
  });
});

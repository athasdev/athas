import { describe, expect, it } from "vite-plus/test";
import type { ModelMessage } from "ai";
import {
  fitStepMessages,
  getStepRequestLimits,
  serializedBytes,
  TRIMMED_TOOL_RESULT,
} from "../intelligence/lib/intelligence-step-budget";
import { HOSTED_ATHAS_REQUEST_LIMITS } from "../lib/conversation-history";

function toolStep(id: string, toolName: string, size: number): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: id, toolName, input: { path: `${id}.ts` } }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName,
          output: { type: "json", value: { text: "x".repeat(size) } },
        },
      ],
    },
  ];
}

const prompt: ModelMessage[] = [{ role: "user", content: "Refactor the parser" }];

function outputs(messages: ModelMessage[]) {
  return messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) =>
          part.type === "tool-result"
            ? [part.output.type === "text" ? part.output.value : `${part.toolName}:full`]
            : [],
        )
      : [],
  );
}

describe("agent step budget", () => {
  it("uses the hosted limits for Athas and a generous cap for other providers", () => {
    expect(getStepRequestLimits("athas")).toEqual({
      maxMessages: HOSTED_ATHAS_REQUEST_LIMITS.maxMessages,
      maxBytes: HOSTED_ATHAS_REQUEST_LIMITS.maxBytes,
    });
    expect(getStepRequestLimits("openai").maxBytes).toBeGreaterThan(
      HOSTED_ATHAS_REQUEST_LIMITS.maxBytes,
    );
  });

  it("leaves a request that fits untouched", () => {
    const messages = [...prompt, ...toolStep("a", "read_file", 1_000)];
    expect(fitStepMessages(messages, { maxMessages: 90, maxBytes: 50_000 }, { firstStep: 1 })).toBe(
      undefined,
    );
  });

  it("trims the oldest rereadable results first and keeps the recent ones", () => {
    const messages = [
      ...prompt,
      ...toolStep("cmd", "run_command", 5_000),
      ...Array.from({ length: 8 }, (_, index) => toolStep(`r${index}`, "read_file", 5_000)).flat(),
    ];
    const fitted = fitStepMessages(
      messages,
      { maxMessages: 90, maxBytes: 40_000 },
      { firstStep: 1 },
    )!;

    expect(serializedBytes(fitted)).toBeLessThanOrEqual(40_000);
    expect(outputs(fitted)).toEqual([
      "run_command:full",
      TRIMMED_TOOL_RESULT,
      TRIMMED_TOOL_RESULT,
      "read_file:full",
      "read_file:full",
      "read_file:full",
      "read_file:full",
      "read_file:full",
      "read_file:full",
    ]);
    expect(messages[4]).toEqual(toolStep("r0", "read_file", 5_000)[1]);
  });

  it("trims other results and then recent ones when rereadable ones are not enough", () => {
    const messages = [
      ...prompt,
      ...toolStep("cmd", "run_command", 20_000),
      ...toolStep("r1", "read_file", 20_000),
      ...toolStep("r2", "mcp__github__search", 20_000),
    ];
    const fitted = fitStepMessages(
      messages,
      { maxMessages: 90, maxBytes: 25_000 },
      { firstStep: 1, instructionBytes: 2_000 },
    )!;

    expect(outputs(fitted)).toEqual([
      TRIMMED_TOOL_RESULT,
      TRIMMED_TOOL_RESULT,
      "mcp__github__search:full",
    ]);
    expect(serializedBytes(fitted) + 2_000).toBeLessThanOrEqual(25_000);
  });

  it("drops the oldest steps of the turn in pairs when there are too many messages", () => {
    const history: ModelMessage[] = [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      ...prompt,
    ];
    const steps = Array.from({ length: 6 }, (_, index) => toolStep(`s${index}`, "read_file", 10));
    const fitted = fitStepMessages(
      [...history, ...steps.flat()],
      { maxMessages: 9, maxBytes: 1_000_000 },
      { firstStep: history.length },
    )!;

    expect(fitted).toHaveLength(9);
    expect(fitted.slice(0, 3)).toEqual(history);
    const note = fitted[3];
    expect(note.role).toBe("assistant");
    expect(note.content[0]).toEqual({
      type: "text",
      text: "[3 earlier tool steps of this turn removed to fit the request limit]",
    });
    // Every remaining call still has its result right after it.
    for (let index = 3; index < fitted.length; index += 2) {
      expect(fitted[index].role).toBe("assistant");
      expect(fitted[index + 1].role).toBe("tool");
    }

    const again = fitStepMessages(
      [...fitted, ...toolStep("s6", "read_file", 10)],
      { maxMessages: 9, maxBytes: 1_000_000 },
      { firstStep: history.length },
    )!;
    expect(again[3].content[0]).toEqual({
      type: "text",
      text: "[4 earlier tool steps of this turn removed to fit the request limit]",
    });
    expect(again).toHaveLength(9);
  });
});

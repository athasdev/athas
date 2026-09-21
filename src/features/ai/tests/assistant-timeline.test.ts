import { describe, expect, it } from "vite-plus/test";
import { buildAssistantTimeline } from "@/features/ai/lib/assistant-timeline";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

const call = (name: string, contentOffset?: number): ToolCall => ({
  id: name,
  name,
  input: {},
  timestamp: new Date(0),
  contentOffset,
});

describe("assistant timeline", () => {
  it("places tool calls between the text that surrounded them", () => {
    const content = "Let me look.\n\nDone, here is the result.";
    const segments = buildAssistantTimeline(content, [call("read", "Let me look.".length)]);

    expect(segments).toEqual([
      { text: "Let me look.", toolCalls: [call("read", "Let me look.".length)] },
      { text: "Done, here is the result.", toolCalls: [] },
    ]);
  });

  it("groups calls that started at the same point and keeps their order", () => {
    const segments = buildAssistantTimeline("Intro", [
      call("second", 5),
      call("first", 0),
      call("third", 5),
    ]);

    expect(segments.map((segment) => segment.toolCalls.map((tool) => tool.name))).toEqual([
      ["first"],
      ["second", "third"],
    ]);
    expect(segments[0].text).toBe("");
    expect(segments[1].text).toBe("Intro");
  });

  it("trails calls from older history after the text", () => {
    const segments = buildAssistantTimeline("Answer", [call("legacy")]);

    expect(segments).toEqual([{ text: "Answer", toolCalls: [call("legacy")] }]);
  });

  it("returns plain text when there are no tool calls", () => {
    expect(buildAssistantTimeline("  Hello  ")).toEqual([{ text: "Hello", toolCalls: [] }]);
    expect(buildAssistantTimeline("")).toEqual([]);
  });
});

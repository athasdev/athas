import { describe, expect, it } from "vite-plus/test";
import { buildAssistantSegments } from "@/features/ai/lib/assistant-segments";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";

const call = (id: string, contentOffset: number): ToolCall => ({
  id,
  name: "read_file",
  input: {},
  timestamp: new Date(0),
  contentOffset,
});

const intro = "Looking around first.";
const plan = "[PLAN_BLOCK]\n[STEP] Update the parser\nChange it.\n[/STEP]\n[/PLAN_BLOCK]";
const content = `${intro}\n\n${plan}\n\nStarting now.`;

describe("assistant segments", () => {
  it("interleaves tool calls around a plan", () => {
    const before = call("before", intro.length);
    const after = call("after", content.length);
    const segments = buildAssistantSegments(content, [before, after]);

    expect(segments.map((segment) => segment.toolCalls)).toEqual([[before], [after]]);
    expect(segments[0]!.plan).toBeNull();
    expect(segments[1]!.plan?.steps).toHaveLength(1);
    expect(segments[1]!.plan?.afterPlan).toBe("Starting now.");
  });

  it("moves a call made mid-plan to after the plan, keeping the original call", () => {
    const during = call("during", content.indexOf("[STEP]"));
    const segments = buildAssistantSegments(content, [during]);

    expect(segments[0]!.plan?.steps[0]!.title).toBe("Update the parser");
    expect(segments[0]!.toolCalls[0]).toBe(during);
    expect(segments[1]).toEqual({ text: "Starting now.", plan: null, toolCalls: [] });
  });
});

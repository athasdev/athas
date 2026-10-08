import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import { buildAssistantTimeline } from "./assistant-timeline";
import { hasPlanBlock, parsePlan, type ParsedPlan } from "./plan-parser";

interface AssistantSegment {
  text: string;
  /** The plan the text holds, when it holds a complete one with steps. */
  plan: ParsedPlan | null;
  toolCalls: ToolCall[];
}

const PLAN_START = "[PLAN_BLOCK]";
const PLAN_END = "[/PLAN_BLOCK]";

/**
 * An assistant message's text and tool calls in the order they happened, like
 * `buildAssistantTimeline`, with a plan block kept whole: a call made while the plan was being
 * written moves to just after it instead of cutting the plan in two.
 */
export function buildAssistantSegments(
  content: string,
  toolCalls: ToolCall[] = [],
): AssistantSegment[] {
  const planStart = content.indexOf(PLAN_START);
  const planEnd = planStart === -1 ? -1 : content.indexOf(PLAN_END, planStart);
  const afterPlan = planEnd === -1 ? -1 : planEnd + PLAN_END.length;

  const originals = new Map<ToolCall, ToolCall>();
  const placed = toolCalls.map((toolCall) => {
    const offset = toolCall.contentOffset;
    if (afterPlan === -1 || offset === undefined || offset <= planStart || offset >= afterPlan) {
      return toolCall;
    }
    const moved = { ...toolCall, contentOffset: afterPlan };
    originals.set(moved, toolCall);
    return moved;
  });

  return buildAssistantTimeline(content, placed).map((segment) => ({
    text: segment.text,
    plan: hasPlanBlock(segment.text) ? parsePlan(segment.text) : null,
    toolCalls: segment.toolCalls.map((toolCall) => originals.get(toolCall) ?? toolCall),
  }));
}

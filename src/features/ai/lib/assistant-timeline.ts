import type { ToolCall } from "@/features/ai/types/ai-chat.types";

export interface AssistantTimelineSegment {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * Interleaves an assistant message's text with its tool calls in the order they
 * happened. Each call remembers how much text existed when it started; calls
 * without that (older history) trail the text like they always did.
 */
export function buildAssistantTimeline(
  content: string,
  toolCalls: ToolCall[] = [],
): AssistantTimelineSegment[] {
  const offsetOf = (toolCall: ToolCall) =>
    Math.max(0, Math.min(content.length, toolCall.contentOffset ?? content.length));
  const ordered = toolCalls
    .map((toolCall, index) => ({ toolCall, offset: offsetOf(toolCall), index }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index);

  const segments: AssistantTimelineSegment[] = [];
  let cursor = 0;
  let pending: ToolCall[] = [];
  let pendingOffset = -1;

  const flush = () => {
    if (pending.length === 0) return;
    segments.push({ text: content.slice(cursor, pendingOffset).trim(), toolCalls: pending });
    cursor = pendingOffset;
    pending = [];
  };

  for (const entry of ordered) {
    if (entry.offset !== pendingOffset) {
      flush();
      pendingOffset = entry.offset;
    }
    pending.push(entry.toolCall);
  }
  flush();

  const tail = content.slice(cursor).trim();
  if (tail) segments.push({ text: tail, toolCalls: [] });

  return segments.filter((segment) => segment.text || segment.toolCalls.length > 0);
}

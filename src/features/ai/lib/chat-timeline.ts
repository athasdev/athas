import type { Message } from "@/features/ai/types/ai-chat.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";

export type ChatTimelineItem =
  | { id: string; type: "message"; message: Message; messageIndex: number }
  | { id: string; type: "acp"; event: ChatAcpEvent };

const toMs = (value: Date | string): number => {
  const timestamp = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/**
 * Messages keep their stored order no matter what their timestamps say (an
 * edited prompt is re-stamped but must stay above its answer); agent events
 * slot in between them by time.
 */
export function buildChatTimeline(
  messages: Message[],
  acpEvents: ChatAcpEvent[] = [],
): ChatTimelineItem[] {
  let floor = 0;
  const entries = messages.map((message, messageIndex) => {
    floor = Math.max(floor, toMs(message.timestamp));
    return {
      item: { id: `message-${message.id}`, type: "message", message, messageIndex } as const,
      timestamp: floor,
      order: messageIndex,
    };
  });
  const events = acpEvents.map((event, eventIndex) => ({
    item: { id: `acp-${event.id}`, type: "acp", event } as const,
    timestamp: toMs(event.timestamp),
    order: messages.length + eventIndex,
  }));

  return [...entries, ...events]
    .sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
    .map((entry) => entry.item);
}

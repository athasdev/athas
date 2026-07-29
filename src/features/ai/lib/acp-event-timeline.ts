import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";

export type ChatAcpEventInput = Omit<ChatAcpEvent, "id" | "timestamp"> & {
  id?: string;
};

export const appendChatAcpEvent = (
  previousEvents: ChatAcpEvent[],
  event: ChatAcpEventInput,
): ChatAcpEvent[] => {
  const now = new Date();
  const eventId = event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextEvent: ChatAcpEvent = {
    ...event,
    id: eventId,
    timestamp: now,
  };

  return [...previousEvents, nextEvent];
};

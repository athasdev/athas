import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";

const MAX_EVENTS = 40;
const DEDUPE_WINDOW_MS = 1200;
const MAX_DETAIL_LENGTH = 220;

export type ChatAcpEventInput = Omit<ChatAcpEvent, "id" | "timestamp"> & {
  id?: string;
};

export const truncateDetail = (value: string, maxLength = MAX_DETAIL_LENGTH): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

export const appendChatAcpEvent = (
  previousEvents: ChatAcpEvent[],
  event: ChatAcpEventInput,
): ChatAcpEvent[] => {
  const now = new Date();
  const eventId = event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextEvent: ChatAcpEvent = {
    ...event,
    detail: event.detail ? truncateDetail(event.detail) : undefined,
    id: eventId,
    timestamp: now,
  };

  const last = previousEvents[previousEvents.length - 1];
  if (
    last &&
    last.kind === nextEvent.kind &&
    last.label === nextEvent.label &&
    (last.detail ?? "") === (nextEvent.detail ?? "") &&
    last.state === nextEvent.state &&
    now.getTime() - last.timestamp.getTime() < DEDUPE_WINDOW_MS
  ) {
    return [...previousEvents.slice(0, -1), { ...last, timestamp: now }];
  }

  return [...previousEvents.slice(-(MAX_EVENTS - 1)), nextEvent];
};

export const completeThinkingAcpEvents = (previousEvents: ChatAcpEvent[]): ChatAcpEvent[] => {
  const now = new Date();
  let changed = false;
  const updated = previousEvents.map((event) => {
    if (event.kind === "thinking" && event.state === "running") {
      changed = true;
      return { ...event, state: "success" as const, timestamp: now };
    }
    return event;
  });
  return changed ? updated : previousEvents;
};

const completeToolLabel = (label: string, success: boolean): string => {
  if (!success) return label;

  switch (label) {
    case "Editing file":
      return "Edited file";
    case "Reading file":
      return "Read file";
    case "Deleting file":
      return "Deleted file";
    case "Moving file":
      return "Moved file";
    case "Searching":
      return "Searched";
    case "Running command":
      return "Ran command";
    case "Fetching":
      return "Fetched";
    default:
      return label;
  }
};

export const updateToolCompletionAcpEvent = (
  previousEvents: ChatAcpEvent[],
  activityId: string,
  success: boolean,
): ChatAcpEvent[] => {
  const hasExisting = previousEvents.some((event) => event.id === activityId);
  const completionDetail = success ? "completed" : "failed";
  const completionState: ChatAcpEvent["state"] = success ? "success" : "error";

  if (!hasExisting) {
    return appendChatAcpEvent(previousEvents, {
      id: activityId,
      kind: "tool",
      label: "Tool call",
      detail: completionDetail,
      state: completionState,
    });
  }

  const now = new Date();
  return previousEvents.map((event) =>
    event.id === activityId
      ? {
          ...event,
          label: completeToolLabel(event.label, success),
          detail: event.detail ?? completionDetail,
          state: completionState,
          timestamp: now,
        }
      : event,
  );
};

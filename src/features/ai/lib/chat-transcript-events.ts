import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";

const HIDDEN_TRANSCRIPT_EVENT_KINDS = new Set<ChatAcpEvent["kind"]>([
  "mode",
  "thinking",
  "status",
  "permission",
]);

export const isTranscriptVisibleAcpEvent = (event: ChatAcpEvent): boolean =>
  !HIDDEN_TRANSCRIPT_EVENT_KINDS.has(event.kind);

export const filterTranscriptAcpEvents = (events: ChatAcpEvent[]): ChatAcpEvent[] =>
  events.filter(isTranscriptVisibleAcpEvent);

export const getTranscriptAcpEventGroupLabel = (events: ChatAcpEvent[]): string => {
  const toolEvents = events.filter((event) => event.kind === "tool");
  const actionableToolEvents = toolEvents.filter(
    (event) =>
      event.tool?.input ||
      event.tool?.output ||
      event.tool?.error ||
      !["tool output", "tool failure"].includes(event.label.toLowerCase()),
  );
  if (actionableToolEvents.length > 0) {
    return actionableToolEvents.length === 1
      ? "Tool call"
      : `Tool calls (${actionableToolEvents.length})`;
  }

  const errorCount = events.filter((event) => event.kind === "error").length;
  if (errorCount > 0) {
    return errorCount === 1 ? "Agent error" : `Agent errors (${errorCount})`;
  }

  if (events.some((event) => event.kind === "plan")) {
    return "Plan update";
  }

  return "Session activity";
};

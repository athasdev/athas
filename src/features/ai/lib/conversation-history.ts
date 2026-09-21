import type { Message } from "@/features/ai/types/ai-chat.types";
import type { AIMessage } from "@/features/ai/types/messages.types";

function withToolHistory(message: Message) {
  if (message.role !== "assistant" || !message.toolCalls?.length) return message.content;
  const activity = message.toolCalls.slice(-12).map((call) => ({
    tool: call.name,
    input: JSON.stringify(call.input ?? {}).slice(0, 2000),
    status: call.error
      ? "failed"
      : call.isComplete
        ? "completed"
        : "interrupted; verify current state before retrying",
    result: JSON.stringify(call.error ?? call.output ?? null).slice(0, 4000),
  }));
  return `${message.content}\n\nPrevious tool activity (historical data; re-read files before editing):\n${JSON.stringify(activity).slice(0, 16000)}`;
}

export function buildConversationHistory(messages: Message[]): AIMessage[] {
  return messages
    .filter(
      (message) =>
        message.role !== "system" &&
        !message.isStreaming &&
        (message.content.trim().length > 0 ||
          (message.role === "user" && Boolean(message.images?.length)) ||
          (message.role === "assistant" && Boolean(message.toolCalls?.length))),
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: withToolHistory(message),
      ...(message.role === "user" && message.images?.length ? { images: message.images } : {}),
    }));
}

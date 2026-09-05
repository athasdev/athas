import type { Message } from "@/features/ai/types/ai-chat.types";
import type { AIMessage } from "@/features/ai/types/messages.types";

export function buildConversationHistory(messages: Message[]): AIMessage[] {
  return messages
    .filter(
      (message) =>
        message.role !== "system" &&
        !message.isStreaming &&
        (message.content.trim().length > 0 ||
          (message.role === "user" && Boolean(message.images?.length))),
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      ...(message.role === "user" && message.images?.length ? { images: message.images } : {}),
    }));
}

import type { Message } from "@/features/ai/types/ai-chat.types";
import type { AIMessage } from "@/features/ai/types/messages.types";

export function buildConversationHistory(messages: Message[]): AIMessage[] {
  return messages
    .filter(
      (message) =>
        message.role !== "system" && !message.isStreaming && message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

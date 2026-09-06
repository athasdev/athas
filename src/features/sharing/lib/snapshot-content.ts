import type { Message } from "@/features/ai/types/ai-chat.types";
import { redactLocalPaths } from "@/features/ai/lib/shareable-outcome";

export function selectionContent(content: string, start: number, end: number) {
  return content.slice(Math.min(start, end), Math.max(start, end));
}

export function conversationMessages(messages: Message[]) {
  return messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: redactLocalPaths(message.content),
    }));
}

export function conversationContent(messages: Message[]) {
  return conversationMessages(messages)
    .map((message) => `## ${message.role === "user" ? "You" : "Agent"}\n\n${message.content}`)
    .join("\n\n");
}

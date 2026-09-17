import type { ModelMessage } from "ai";

export function toIntelligenceSdkPrompt(messages: ModelMessage[]) {
  return {
    instructions: messages.filter((message) => message.role === "system"),
    messages: messages.filter((message) => message.role !== "system"),
  };
}

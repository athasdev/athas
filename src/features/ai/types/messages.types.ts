import type { ImageContent } from "./ai-chat.types";

interface AIUserMessage {
  role: "user";
  content: string;
  images?: ImageContent[];
}

interface AIAssistantMessage {
  role: "assistant";
  content: string;
}

interface AISystemMessage {
  role: "system";
  content: string;
}

export type AIMessage = AIUserMessage | AIAssistantMessage | AISystemMessage;

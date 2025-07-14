export interface AIUserMessage {
  role: "user";
  content: string;
}

export interface AIAssistantMessage {
  role: "assistant";
  content: string;
}

export interface AISystemMessage {
  role: "system";
  content: string;
}

export type AIMessage = AIUserMessage | AIAssistantMessage | AISystemMessage;

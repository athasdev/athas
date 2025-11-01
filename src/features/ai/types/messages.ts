interface AIUserMessage {
  role: "user";
  content: string;
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

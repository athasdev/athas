import type { Chat, Message, ToolCall } from "@/features/ai/types/ai-chat";

const createClonedToolCall = (toolCall: ToolCall): ToolCall => ({
  ...toolCall,
  input: toolCall.input ? structuredClone(toolCall.input) : toolCall.input,
  output: toolCall.output ? structuredClone(toolCall.output) : toolCall.output,
  timestamp: new Date(toolCall.timestamp),
});

const createClonedMessageId = (sourceMessageId: string, index: number): string =>
  `${sourceMessageId}:fork:${Date.now()}:${index}`;

export const getMessageLineageId = (message: Pick<Message, "id" | "lineageMessageId">): string =>
  message.lineageMessageId || message.id;

export const normalizeChatMessage = (message: Message): Message => ({
  ...message,
  kind: message.kind ?? "default",
  lineageMessageId: getMessageLineageId(message),
  summaryMeta: message.summaryMeta ? structuredClone(message.summaryMeta) : message.summaryMeta,
  timestamp: new Date(message.timestamp),
  toolCalls: message.toolCalls?.map(createClonedToolCall),
  images: message.images ? structuredClone(message.images) : message.images,
  resources: message.resources ? structuredClone(message.resources) : message.resources,
});

export const createRootChatLineage = (chatId: string) => ({
  parentChatId: null,
  rootChatId: chatId,
  branchPointMessageId: null,
  lineageDepth: 0,
  sessionName: null,
});

export const cloneMessagesForFork = (messages: Message[]): Message[] => {
  return messages.map((message, index) =>
    normalizeChatMessage({
      ...message,
      id: createClonedMessageId(message.id, index),
      lineageMessageId: getMessageLineageId(message),
      isStreaming: false,
    }),
  );
};

export const createForkedChatLineage = (
  sourceChat: Pick<Chat, "id" | "rootChatId" | "lineageDepth" | "sessionName" | "title">,
  branchPointMessageId: string | null,
) => ({
  parentChatId: sourceChat.id,
  rootChatId: sourceChat.rootChatId,
  branchPointMessageId,
  lineageDepth: sourceChat.lineageDepth + 1,
  sessionName: sourceChat.sessionName ?? sourceChat.title,
});

export const getChatLineageLabel = (chat: Pick<Chat, "lineageDepth">): "Root" | "Child" => {
  return chat.lineageDepth === 0 ? "Root" : "Child";
};

export const getChatLineagePath = (
  chats: Array<Pick<Chat, "id" | "parentChatId">>,
  chatId: string | null,
): string[] => {
  if (!chatId) {
    return [];
  }

  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const lineagePath: string[] = [];
  let currentChatId: string | null = chatId;

  while (currentChatId) {
    const chat = chatsById.get(currentChatId);
    if (!chat) {
      break;
    }

    lineagePath.unshift(chat.id);
    currentChatId = chat.parentChatId;
  }

  return lineagePath;
};

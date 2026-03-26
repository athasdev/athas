import type {
  BranchSummaryMeta,
  Chat,
  ChatMessageKind,
  CompactionSummaryMeta,
  Message,
} from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import { getMessageLineageId, normalizeChatMessage } from "./chat-lineage";

export const CHAT_COMPACTION_RESERVE_TOKENS = 16384;
export const CHAT_COMPACTION_KEEP_RECENT_TOKENS = 20000;

const hasRenderableContent = (message: Message): boolean => message.content.trim().length > 0;

export const isSummaryMessage = (message: Message): boolean => message.kind !== "default";

export const isCompactionSummaryMessage = (
  message: Message,
): message is Message & {
  kind: "compaction-summary";
  summaryMeta: CompactionSummaryMeta;
} => message.kind === "compaction-summary" && message.summaryMeta?.type === "compaction";

export const isBranchSummaryMessage = (
  message: Message,
): message is Message & {
  kind: "branch-summary";
  summaryMeta: BranchSummaryMeta;
} => message.kind === "branch-summary" && message.summaryMeta?.type === "branch";

export const getChatSummaryCounts = (chat: Pick<Chat, "messages">) =>
  chat.messages.reduce(
    (counts, message) => {
      if (message.kind === "compaction-summary") counts.compaction += 1;
      if (message.kind === "branch-summary") counts.branch += 1;
      return counts;
    },
    { compaction: 0, branch: 0 },
  );

export const getEffectiveChatMessages = (chat: Pick<Chat, "messages">): Message[] => {
  const messages = chat.messages.map(normalizeChatMessage);
  const latestCompactionIndex = [...messages]
    .reverse()
    .findIndex((message) => message.kind === "compaction-summary");

  if (latestCompactionIndex === -1) {
    return messages;
  }

  const resolvedCompactionIndex = messages.length - latestCompactionIndex - 1;
  const compactionMessage = messages[resolvedCompactionIndex];
  if (!isCompactionSummaryMessage(compactionMessage)) {
    return messages;
  }

  const firstKeptIndex = compactionMessage.summaryMeta.firstKeptLineageMessageId
    ? messages.findIndex(
        (message, index) =>
          index < resolvedCompactionIndex &&
          getMessageLineageId(message) === compactionMessage.summaryMeta.firstKeptLineageMessageId,
      )
    : -1;

  const keptPrefix =
    firstKeptIndex >= 0 ? messages.slice(firstKeptIndex, resolvedCompactionIndex) : [];
  const tail = messages.slice(resolvedCompactionIndex + 1);

  return [compactionMessage, ...keptPrefix, ...tail];
};

export const buildConversationHistory = (chat: Pick<Chat, "messages">): AIMessage[] =>
  getEffectiveChatMessages(chat)
    .filter((message) => !message.isStreaming)
    .filter((message) => hasRenderableContent(message) || isSummaryMessage(message))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

export const estimateChatMessageTokens = (message: Message): number => {
  let chars = message.content.length;

  if (message.toolCalls?.length) {
    for (const toolCall of message.toolCalls) {
      chars += toolCall.name.length;
      if (toolCall.input) chars += JSON.stringify(toolCall.input).length;
      if (toolCall.output) chars += JSON.stringify(toolCall.output).length;
      if (toolCall.error) chars += toolCall.error.length;
    }
  }

  if (message.images?.length) {
    chars += message.images.length * 4800;
  }

  if (message.resources?.length) {
    for (const resource of message.resources) {
      chars += resource.uri.length + (resource.name?.length || 0);
    }
  }

  return Math.ceil(chars / 4);
};

export const estimateChatMessagesTokens = (messages: Message[]): number =>
  messages.reduce((total, message) => total + estimateChatMessageTokens(message), 0);

const isContextMessage = (message: Message): boolean =>
  !message.isStreaming && (hasRenderableContent(message) || isSummaryMessage(message));

export interface ChatCompactionPlan {
  messagesToSummarize: Message[];
  effectiveMessages: Message[];
  firstKeptLineageMessageId: string | null;
  tokensBefore: number;
}

export const prepareChatCompaction = (
  chat: Pick<Chat, "messages">,
  modelMaxTokens: number,
  reserveTokens: number = CHAT_COMPACTION_RESERVE_TOKENS,
  keepRecentTokens: number = CHAT_COMPACTION_KEEP_RECENT_TOKENS,
  force: boolean = false,
): ChatCompactionPlan | null => {
  const effectiveMessages = getEffectiveChatMessages(chat).filter(isContextMessage);
  const tokensBefore = estimateChatMessagesTokens(effectiveMessages);

  if (effectiveMessages.length < 3 || (!force && tokensBefore <= modelMaxTokens - reserveTokens)) {
    return null;
  }

  let accumulatedTokens = 0;
  let firstKeptIndex = 0;

  for (let index = effectiveMessages.length - 1; index >= 0; index -= 1) {
    accumulatedTokens += estimateChatMessageTokens(effectiveMessages[index]);
    firstKeptIndex = index;
    if (accumulatedTokens >= keepRecentTokens) {
      break;
    }
  }

  if (firstKeptIndex <= 0 || firstKeptIndex >= effectiveMessages.length) {
    return null;
  }

  const messagesToSummarize = effectiveMessages.slice(0, firstKeptIndex);
  const firstKeptLineageMessageId = getMessageLineageId(effectiveMessages[firstKeptIndex]);

  if (messagesToSummarize.length === 0) {
    return null;
  }

  return {
    messagesToSummarize,
    effectiveMessages,
    firstKeptLineageMessageId,
    tokensBefore,
  };
};

export interface BranchDeltaResult {
  commonAncestorLineageMessageId: string | null;
  sourceLastLineageMessageId: string | null;
  messages: Message[];
}

export const getBranchDeltaMessages = (
  sourceChat: Pick<Chat, "messages" | "rootChatId">,
  targetChat: Pick<Chat, "messages" | "rootChatId">,
): BranchDeltaResult | null => {
  if (sourceChat.rootChatId !== targetChat.rootChatId) {
    return null;
  }

  const sourceMessages = getEffectiveChatMessages(sourceChat).filter(isContextMessage);
  const targetMessages = getEffectiveChatMessages(targetChat).filter(isContextMessage);
  const maxSharedLength = Math.min(sourceMessages.length, targetMessages.length);

  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < maxSharedLength &&
    getMessageLineageId(sourceMessages[sharedPrefixLength]) ===
      getMessageLineageId(targetMessages[sharedPrefixLength])
  ) {
    sharedPrefixLength += 1;
  }

  const messages = sourceMessages.slice(sharedPrefixLength);
  if (messages.length === 0) {
    return null;
  }

  return {
    commonAncestorLineageMessageId:
      sharedPrefixLength > 0 ? getMessageLineageId(sourceMessages[sharedPrefixLength - 1]) : null,
    sourceLastLineageMessageId: getMessageLineageId(sourceMessages[sourceMessages.length - 1]),
    messages,
  };
};

export const createSummaryMessage = (
  kind: Extract<ChatMessageKind, "compaction-summary" | "branch-summary">,
  content: string,
  summaryMeta: Message["summaryMeta"],
): Message => {
  const id = crypto.randomUUID();

  return normalizeChatMessage({
    id,
    lineageMessageId: id,
    kind,
    summaryMeta,
    content,
    role: "system",
    timestamp: new Date(),
  });
};

import { estimateTokens } from "@/features/ai/lib/context-budget";
import {
  buildConversationHistory,
  summarizeConversationExtractively,
  type ConversationSummarizer,
} from "@/features/ai/lib/conversation-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Message } from "@/features/ai/types/ai-chat.types";

/** Recent history `/compact` keeps word for word. */
const MANUAL_COMPACT_KEEP_TOKENS = 4_000;

/** Index of the first message to keep: a user turn, so the kept history starts cleanly. */
function recentStart(messages: Message[], keepTokens: number) {
  let tokens = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    tokens += estimateTokens(messages[index].content);
    if (tokens > keepTokens && start < messages.length) break;
    start = index;
  }
  while (start < messages.length && messages[start].role !== "user") start++;
  return start;
}

/**
 * What `/compact` leaves behind: one summary of the earlier turns, then the most recent turns
 * as they were. The summary is a user turn so the history the model sees still opens with one.
 */
export async function compactChatMessages(
  messages: Message[],
  {
    keepRecentTokens = MANUAL_COMPACT_KEEP_TOKENS,
    summarize = summarizeConversationExtractively,
  }: { keepRecentTokens?: number; summarize?: ConversationSummarizer } = {},
): Promise<{ messages: Message[]; compactedCount: number }> {
  const settled = messages.filter((message) => !message.isStreaming);
  let start = recentStart(settled, keepRecentTokens);
  // Short chats keep only their last turn, so compacting always frees something up.
  if (start === 0 || start >= settled.length) {
    let lastUser = settled.length - 1;
    while (lastUser > 0 && settled[lastUser].role !== "user") lastUser--;
    start = lastUser > 0 ? lastUser : settled.length;
  }
  const older = settled.slice(0, start);
  const olderHistory = buildConversationHistory(older);
  if (olderHistory.length === 0) return { messages, compactedCount: 0 };

  let summary: string;
  try {
    summary = await summarize(olderHistory);
  } catch {
    summary = summarizeConversationExtractively(olderHistory);
  }
  const summaryMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: `[Summary of ${older.length} earlier messages in this conversation]\n${summary.trim()}\n[End of summary]`,
    timestamp: older[0]?.timestamp ?? new Date(),
  };
  return { messages: [summaryMessage, ...settled.slice(start)], compactedCount: older.length };
}

/** Compacts a built-in agent chat in place and returns how many messages were summarised. */
export async function compactChat(chatId: string): Promise<number> {
  const actions = useAIChatStore.getState().actions;
  const result = await compactChatMessages(actions.getMessagesForChat(chatId));
  if (result.compactedCount > 0) actions.replaceChatMessages(chatId, result.messages);
  return result.compactedCount;
}

export function clearChat(chatId: string) {
  useAIChatStore.getState().actions.replaceChatMessages(chatId, []);
}

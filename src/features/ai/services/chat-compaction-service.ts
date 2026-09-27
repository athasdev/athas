import { estimateTokens } from "@/features/ai/lib/context-budget";
import {
  buildConversationHistory,
  summarizeConversationExtractively,
  type ConversationSummarizer,
} from "@/features/ai/lib/conversation-history";
import { clearChatCheckpoints } from "@/features/ai/services/agent-checkpoints-service";
import { rejectAllAgentEdits } from "@/features/ai/services/agent-edits-service";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Message } from "@/features/ai/types/ai-chat.types";
import { showChoiceDialog } from "@/ui/dialog";

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

/**
 * Empties a chat, with its agent changes review and checkpoints, which belong to the turns being
 * removed. When the agent's changes are still unreviewed the user decides whether they stay in
 * the files or are taken back out; dismissing that choice leaves the chat as it was. Returns
 * whether the chat was cleared.
 */
export async function clearChat(chatId: string): Promise<boolean> {
  const pending = Object.keys(getAgentEditEntries(chatId)).length;
  if (pending > 0) {
    const files = pending === 1 ? "1 file" : `${pending} files`;
    const choice = await showChoiceDialog(
      `The agent's changes to ${files} in this chat are not reviewed yet. Keep them in your files, or discard them before clearing?`,
      {
        title: "Clear chat",
        choices: [
          { value: "keep", label: "Keep changes", variant: "accent" },
          { value: "discard", label: "Discard changes", variant: "default" },
        ],
      },
    );
    if (choice === null) return false;
    if (choice === "discard") {
      await rejectAllAgentEdits(chatId);
      // A file whose unsaved edits overlap the change could not be reverted; its review stays.
      if (Object.keys(getAgentEditEntries(chatId)).length > 0) return false;
    }
  }
  useAgentEditsStore.getState().actions.forgetChat(chatId);
  await clearChatCheckpoints(chatId);
  useAIChatStore.getState().actions.replaceChatMessages(chatId, []);
  return true;
}

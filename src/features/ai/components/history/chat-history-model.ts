import type { Chat } from "@/features/ai/types/ai-chat.types";
import { matchesSearchQuery } from "@/utils/search-match";

export function filterChatHistory(chats: Chat[], query: string) {
  return chats.filter((chat) => matchesSearchQuery(query, [chat.title, chat.agentId || "custom"]));
}

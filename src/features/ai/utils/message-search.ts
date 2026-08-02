import type { Message } from "@/features/ai/types/ai-chat.types";

export function getMessageSearchMatches(messages: Message[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return messages.flatMap((message) => {
    const content = message.content.toLowerCase();
    const matches: Array<{ messageId: string }> = [];
    let index = content.indexOf(normalizedQuery);

    while (index !== -1) {
      matches.push({ messageId: message.id });
      index = content.indexOf(normalizedQuery, index + normalizedQuery.length);
    }

    return matches;
  });
}

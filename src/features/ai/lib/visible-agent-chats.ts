/**
 * The chats this window currently shows. An agent chat is mounted only while
 * its tab is the one on screen, so a mounted chat is a visible one.
 */
const visibleChats = new Map<string, number>();

/** Marks the chat as shown until the returned function is called. */
export function markAgentChatVisible(chatId: string): () => void {
  visibleChats.set(chatId, (visibleChats.get(chatId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (visibleChats.get(chatId) ?? 1) - 1;
    if (count > 0) visibleChats.set(chatId, count);
    else visibleChats.delete(chatId);
  };
}

export function isAgentChatVisible(chatId: string): boolean {
  return visibleChats.has(chatId);
}

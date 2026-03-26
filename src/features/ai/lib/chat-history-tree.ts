import type { Chat } from "@/features/ai/types/ai-chat";
import { getChatLineagePath } from "./chat-lineage";

export interface ChatHistoryTreeItem {
  chat: Chat;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  descendantCount: number;
  isCollapsed: boolean;
  isCurrent: boolean;
  isOnActivePath: boolean;
}

const sortRootChats = (left: Chat, right: Chat) =>
  right.lastMessageAt.getTime() - left.lastMessageAt.getTime();

const sortChildChats = (left: Chat, right: Chat) =>
  left.createdAt.getTime() - right.createdAt.getTime() ||
  left.lastMessageAt.getTime() - right.lastMessageAt.getTime();

export const buildChatHistoryTree = (
  chats: Chat[],
  searchQuery: string,
  collapsedChatIds: Set<string>,
  currentChatId: string | null = null,
): ChatHistoryTreeItem[] => {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const childChatsByParentId = new Map<string, Chat[]>();
  const activeLineagePath = new Set(getChatLineagePath(chats, currentChatId));

  for (const chat of chats) {
    if (!chat.parentChatId || !chatsById.has(chat.parentChatId)) {
      continue;
    }

    const siblings = childChatsByParentId.get(chat.parentChatId) ?? [];
    siblings.push(chat);
    childChatsByParentId.set(chat.parentChatId, siblings);
  }

  for (const siblings of childChatsByParentId.values()) {
    siblings.sort(sortChildChats);
  }

  const includedChatIds = new Set<string>();
  if (normalizedQuery.length > 0) {
    for (const chat of chats) {
      const matchesQuery =
        chat.title.toLowerCase().includes(normalizedQuery) ||
        (chat.sessionName?.toLowerCase().includes(normalizedQuery) ?? false);

      if (!matchesQuery) {
        continue;
      }

      let currentChat: Chat | undefined = chat;
      while (currentChat) {
        includedChatIds.add(currentChat.id);
        currentChat = currentChat.parentChatId
          ? chatsById.get(currentChat.parentChatId)
          : undefined;
      }
    }
  }

  const rootChats = chats
    .filter((chat) => !chat.parentChatId || !chatsById.has(chat.parentChatId))
    .sort(sortRootChats);

  const getDescendantCount = (chatId: string): number => {
    const childChats = childChatsByParentId.get(chatId) ?? [];
    return childChats.reduce((count, childChat) => count + 1 + getDescendantCount(childChat.id), 0);
  };

  const visibleItems: ChatHistoryTreeItem[] = [];
  const visit = (chat: Chat, depth: number) => {
    if (normalizedQuery.length > 0 && !includedChatIds.has(chat.id)) {
      return;
    }

    const childChats = childChatsByParentId.get(chat.id) ?? [];
    const isCollapsed = normalizedQuery.length === 0 && collapsedChatIds.has(chat.id);

    visibleItems.push({
      chat,
      depth,
      hasChildren: childChats.length > 0,
      childCount: childChats.length,
      descendantCount: getDescendantCount(chat.id),
      isCollapsed,
      isCurrent: chat.id === currentChatId,
      isOnActivePath: activeLineagePath.has(chat.id),
    });

    if (isCollapsed) {
      return;
    }

    for (const childChat of childChats) {
      visit(childChat, depth + 1);
    }
  };

  for (const rootChat of rootChats) {
    visit(rootChat, 0);
  }

  return visibleItems;
};

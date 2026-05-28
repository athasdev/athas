import type { Chat } from "@/features/ai/types/ai-chat";

export const normalizeAiWorkspacePath = (workspacePath: string | null | undefined) =>
  workspacePath || null;

export const getChatWorkspacePath = (chat: Pick<Chat, "workspacePath">) =>
  normalizeAiWorkspacePath(chat.workspacePath);

export const isChatInWorkspace = (
  chat: Pick<Chat, "workspacePath">,
  workspacePath: string | null | undefined,
) => getChatWorkspacePath(chat) === normalizeAiWorkspacePath(workspacePath);

export const filterChatsByWorkspace = <T extends Pick<Chat, "workspacePath">>(
  chats: T[],
  workspacePath: string | null | undefined,
) => chats.filter((chat) => isChatInWorkspace(chat, workspacePath));

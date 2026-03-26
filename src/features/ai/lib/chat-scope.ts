import type { AIChatSurface, Chat, ChatScopeId } from "@/features/ai/types/ai-chat";

export const PANEL_CHAT_SCOPE_ID: ChatScopeId = "panel";
export const DEFAULT_HARNESS_SESSION_KEY = "harness";
const HARNESS_CHAT_PREFIX = "harness:";

export function createHarnessSessionKey(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isHarnessChatId(chatId: string): boolean {
  return chatId.startsWith(HARNESS_CHAT_PREFIX);
}

export function createHarnessChatScopeId(sessionKey = DEFAULT_HARNESS_SESSION_KEY): ChatScopeId {
  return `harness:${sessionKey}`;
}

export function isHarnessChatScopeId(scopeId: ChatScopeId): boolean {
  return scopeId.startsWith(HARNESS_CHAT_PREFIX);
}

export function getSurfaceForChatScopeId(scopeId: ChatScopeId): AIChatSurface {
  return isHarnessChatScopeId(scopeId) ? "harness" : "panel";
}

export function createScopedChatId(scopeId: ChatScopeId): string {
  const timestamp = Date.now();
  return isHarnessChatScopeId(scopeId) ? `${scopeId}:${timestamp}` : `${timestamp}`;
}

export function getChatScopeId(chatId: string): ChatScopeId {
  if (!isHarnessChatId(chatId)) return PANEL_CHAT_SCOPE_ID;

  const parts = chatId.split(":");
  if (parts.length >= 3) {
    return `harness:${parts[1]}`;
  }

  return createHarnessChatScopeId();
}

export function getDefaultChatTitle(scopeOrSurface: ChatScopeId | AIChatSurface): string {
  const surface =
    scopeOrSurface === "panel" || scopeOrSurface === "harness"
      ? scopeOrSurface
      : getSurfaceForChatScopeId(scopeOrSurface);
  return surface === "harness" ? "New Session" : "New Chat";
}

export function getDefaultHarnessBufferTitle(sessionKey = DEFAULT_HARNESS_SESSION_KEY): string {
  return sessionKey === DEFAULT_HARNESS_SESSION_KEY ? "Harness" : "Harness Session";
}

export function getHarnessBufferTitle(
  sessionKey = DEFAULT_HARNESS_SESSION_KEY,
  chatTitle?: string | null,
): string {
  const normalizedTitle = chatTitle?.trim();
  if (!normalizedTitle) {
    return getDefaultHarnessBufferTitle(sessionKey);
  }

  const defaultChatTitle = getDefaultChatTitle(createHarnessChatScopeId(sessionKey));
  if (normalizedTitle === defaultChatTitle) {
    return getDefaultHarnessBufferTitle(sessionKey);
  }

  return normalizedTitle;
}

export function isChatInScope(chat: Pick<Chat, "id">, scopeId: ChatScopeId): boolean {
  return getChatScopeId(chat.id) === scopeId;
}

export function filterChatsForScope<T extends Pick<Chat, "id">>(
  chats: T[],
  scopeId: ChatScopeId,
): T[] {
  return chats.filter((chat) => isChatInScope(chat, scopeId));
}

export function filterChatsForSurface<T extends Pick<Chat, "id">>(
  chats: T[],
  surface: AIChatSurface,
): T[] {
  return chats.filter((chat) => getSurfaceForChatScopeId(getChatScopeId(chat.id)) === surface);
}

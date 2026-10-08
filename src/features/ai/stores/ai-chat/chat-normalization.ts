import type { Chat, ChatSession, Message } from "@/features/ai/types/ai-chat.types";
import type { AIChatState } from "./ai-chat-store.types";

/** What a chat without messages in memory reads as; one shared array, so selectors stay stable. */
export const EMPTY_CHAT_MESSAGES: Message[] = Object.freeze([]) as unknown as Message[];

/** A chat's metadata, as the store keeps it apart from its messages. */
export function toChatSession({ messages, ...session }: Chat): ChatSession {
  return { ...session, messageCount: messages.length };
}

/** Splits whole chats into the store's session list and per-chat messages. */
export function normalizeChats(chats: Chat[]): Pick<AIChatState, "chats" | "messagesByChat"> {
  return {
    chats: chats.map(toChatSession),
    messagesByChat: Object.fromEntries(chats.map((chat) => [chat.id, chat.messages])),
  };
}

/** A whole chat again, for code that reads or saves a chat with its messages. */
export function composeChat(session: ChatSession, messages: Message[] | undefined): Chat {
  return { ...session, messages: messages ?? EMPTY_CHAT_MESSAGES };
}

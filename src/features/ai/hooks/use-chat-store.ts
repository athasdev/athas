import { useShallow } from "zustand/react/shallow";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useAIChatStore } from "../stores/ai-chat.store";

const EMPTY_MESSAGE_IDS: string[] = [];

/** A chat's metadata; a streamed token leaves it as it was. */
export function useChatSession(chatId: string | null | undefined): ChatSession | undefined {
  return useAIChatStore((state) =>
    chatId ? state.chats.find((chat) => chat.id === chatId) : undefined,
  );
}

/** A chat's message ids in order; changes only when a message is added or removed. */
export function useChatMessageIds(chatId: string | null | undefined): string[] {
  return useAIChatStore(
    useShallow(
      (state) =>
        (chatId ? state.messagesByChat[chatId] : undefined)?.map((message) => message.id) ??
        EMPTY_MESSAGE_IDS,
    ),
  );
}

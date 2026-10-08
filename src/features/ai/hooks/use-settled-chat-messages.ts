import { useCallback, useEffect, useState } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { EMPTY_CHAT_MESSAGES } from "@/features/ai/stores/ai-chat/chat-normalization";
import type { Message } from "@/features/ai/types/ai-chat.types";

/** A streaming reply changes the conversation every frame; readers follow it at this pace. */
export const CHAT_MESSAGES_SETTLE_MS = 300;

/**
 * The chat's messages, picked up once they stop changing for a moment. Read from the store
 * instead of selected from it, so a streaming reply does not re-render the reader each frame.
 * Messages that appear where there were none (a chat that just loaded) are picked up at once.
 */
export function useSettledChatMessages(
  chatId: string | null,
  settleMs = CHAT_MESSAGES_SETTLE_MS,
): Message[] {
  const read = useCallback(
    () =>
      (chatId ? useAIChatStore.getState().messagesByChat[chatId] : undefined) ??
      EMPTY_CHAT_MESSAGES,
    [chatId],
  );
  const [settled, setSettled] = useState(() => ({ read, messages: read() }));
  let current = settled;
  if (settled.read !== read) {
    current = { read, messages: read() };
    setSettled(current);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () =>
      setSettled((previous) => {
        const messages = read();
        return previous.read === read && previous.messages === messages
          ? previous
          : { read, messages };
      });
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        settle();
      }, settleMs);
    };
    let lastSeen = read();
    // Catches a change between the render and this subscription.
    settle();
    const unsubscribe = useAIChatStore.subscribe(() => {
      const messages = read();
      if (messages === lastSeen) return;
      const wasEmpty = lastSeen.length === 0;
      lastSeen = messages;
      if (wasEmpty) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        settle();
        return;
      }
      schedule();
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [read, settleMs]);

  return current.messages;
}

import { useCallback, useEffect, useState } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { EMPTY_CHAT_MESSAGES } from "@/features/ai/services/chat-normalization";
import type { Message } from "@/features/ai/types/ai-chat.types";

/** A streaming reply changes the conversation every frame; readers follow it at this pace. */
const CHAT_MESSAGES_SETTLE_MS = 300;
/** Longest a continuous stream can hold the messages back. */
const CHAT_MESSAGES_MAX_WAIT_MS = 1000;

/**
 * The chat's messages, picked up once they stop changing for a moment, and at least every
 * `maxWaitMs` while they keep changing. Read from the store instead of selected from it, so a
 * streaming reply does not re-render the reader each frame. Messages that appear where there
 * were none (a chat that just loaded) are picked up at once.
 */
export function useSettledChatMessages(
  chatId: string | null,
  settleMs = CHAT_MESSAGES_SETTLE_MS,
  maxWaitMs = CHAT_MESSAGES_MAX_WAIT_MS,
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
    let burstStartedAt = 0;
    const settle = () =>
      setSettled((previous) => {
        const messages = read();
        return previous.read === read && previous.messages === messages
          ? previous
          : { read, messages };
      });
    const schedule = () => {
      const now = Date.now();
      if (timer === undefined) burstStartedAt = now;
      else clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = undefined;
          settle();
        },
        Math.max(0, Math.min(settleMs, burstStartedAt + maxWaitMs - now)),
      );
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
  }, [read, settleMs, maxWaitMs]);

  return current.messages;
}

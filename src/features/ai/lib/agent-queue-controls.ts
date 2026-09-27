import type { QueuedAgentMessage } from "@/features/ai/types/ai-chat.types";

/** The queued message the user is editing, by chat. Held by reference, like the editor does. */
const editedMessages = new Map<string, QueuedAgentMessage>();
/** Chats whose queue stopped at a message being edited when a turn ended. */
const heldForEdit = new Set<string>();

/**
 * Records which queued message of `chatId` the user is editing, or none. Returns true when the
 * edit ends and the queue had stopped for it, so the caller should send the next message now.
 */
export function setQueuedMessageEditing(
  chatId: string,
  message: QueuedAgentMessage | null,
): boolean {
  if (message) {
    editedMessages.set(chatId, message);
    return false;
  }
  editedMessages.delete(chatId);
  return heldForEdit.delete(chatId);
}

/**
 * Whether the queue must not send `next` yet because the user is editing it. Like Zed, a message
 * being edited is not sent automatically; the queue waits and resumes when the edit ends.
 */
export function holdsQueueForEdit(chatId: string, next: QueuedAgentMessage | undefined): boolean {
  if (!next || editedMessages.get(chatId) !== next) return false;
  heldForEdit.add(chatId);
  return true;
}

/** Keeps a quick second "Send now" from landing before the first one's turn has started. */
const SEND_NOW_SETTLE_MS = 500;
const pendingSendNow = new Map<string, number>();

/** Starts a "Send now" in `chatId`. False, and nothing should happen, while one is pending. */
export function beginQueuedSendNow(chatId: string, now = Date.now()): boolean {
  if (pendingSendNow.has(chatId)) return false;
  pendingSendNow.set(chatId, now);
  return true;
}

/**
 * The turn a "Send now" asked for has started (or the chat's turn ended another way). Another
 * one is accepted once a double click could no longer be the same gesture.
 */
export function settleQueuedSendNow(
  chatId: string,
  now = Date.now(),
  schedule: (callback: () => void, delayMs: number) => void = (callback, delayMs) =>
    void setTimeout(callback, delayMs),
): void {
  const startedAt = pendingSendNow.get(chatId);
  if (startedAt === undefined) return;
  const clear = () => {
    if (pendingSendNow.get(chatId) === startedAt) pendingSendNow.delete(chatId);
  };
  const wait = SEND_NOW_SETTLE_MS - (now - startedAt);
  if (wait <= 0) clear();
  else schedule(clear, wait);
}

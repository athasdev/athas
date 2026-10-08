import { getShareDeviceId } from "./share-device";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isEditorViewOfBuffer, useEditorStateStore } from "@/features/editor/stores/state.store";
import type { ShareDraft } from "../types/share.types";
import {
  conversationContent,
  conversationMessages,
  selectionContent,
} from "../lib/snapshot-content";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { emitAppEvent } from "@/utils/app-events";

export function openShare(draft: ShareDraft) {
  emitAppEvent("athas:open-share", draft);
}

export function shareEditor(selectionOnly = false) {
  const buffer = useBufferStore.getState().actions.getActiveBuffer();
  if (buffer?.type !== "editor") return;
  const editor = useEditorStateStore.getState();
  const selection = isEditorViewOfBuffer(editor.activeEditorViewKey, buffer.id)
    ? editor.selection
    : undefined;
  const content = readBufferText(buffer);
  if (selectionOnly && (!selection || selection.start.offset === selection.end.offset)) return;
  openShare({
    sourceId: buffer.id,
    deviceId: getShareDeviceId(),
    kind: selectionOnly ? "snippet" : "buffer",
    title: buffer.name,
    language: buffer.languageOverride || buffer.language || "text",
    startLine:
      selectionOnly && selection ? Math.min(selection.start.line, selection.end.line) + 1 : 1,
    content:
      selectionOnly && selection
        ? selectionContent(content, selection.start.offset, selection.end.offset)
        : content,
  });
}

export async function shareAgent(chatId?: string) {
  const state = useAIChatStore.getState();
  const id = chatId ?? state.currentChatId;
  let chat = id ? state.actions.getChatById(id) : undefined;
  if (!chat) return;
  if (!chat.messages.length) {
    await state.actions.loadChatMessages(chat.id);
    chat = useAIChatStore.getState().actions.getChatById(chat.id);
    if (!chat) return;
  }
  openShare({
    sourceUpdatedAt: chat.lastMessageAt.getTime(),
    sourceId: chat.id,
    deviceId: getShareDeviceId(),
    kind: "agent",
    title: chat.title,
    content: conversationContent(chat.messages),
    language: "markdown",
    messages: conversationMessages(chat.messages),
  });
}

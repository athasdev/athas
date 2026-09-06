import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import type { ShareDraft } from "../types/share.types";
import {
  conversationContent,
  conversationMessages,
  selectionContent,
} from "../lib/snapshot-content";

export const OPEN_SHARE_EVENT = "athas:open-share";

export function openShare(draft: ShareDraft) {
  window.dispatchEvent(new CustomEvent<ShareDraft>(OPEN_SHARE_EVENT, { detail: draft }));
}

export function shareEditor(selectionOnly = false) {
  const { buffers, activeBufferId } = useBufferStore.getState();
  const buffer = buffers.find((entry) => entry.id === activeBufferId);
  if (buffer?.type !== "editor") return;
  const editor = useEditorStateStore.getState();
  const selection = editor.filePath === buffer.path ? editor.selection : undefined;
  const content = buffer.content;
  if (selectionOnly && (!selection || selection.start.offset === selection.end.offset)) return;
  openShare({
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

export function shareAgent(chatId?: string) {
  const state = useAIChatStore.getState();
  const chat = state.chats.find((entry) => entry.id === (chatId ?? state.currentChatId));
  if (!chat) return;
  openShare({
    kind: "agent",
    title: chat.title,
    content: conversationContent(chat.messages),
    language: "markdown",
    messages: conversationMessages(chat.messages),
  });
}

import type { EditorSelectionContext } from "@/features/editor/types/editor-selection.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { openAgentWindowSession } from "@/features/ai/detached/services/agent-window-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { createEditorSelectionContext } from "@/features/editor/services/editor-agent-context";
import { getLanguageIdFromPath } from "@/features/editor/services/language-id";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { openNewAgentChat } from "./open-new-agent-chat";

/**
 * Adds editor selections to the composer of the current agent chat and shows that chat. Falls
 * back to a new chat when there is no current chat.
 */
export function addEditorSelectionsToAgentChat(
  editorSelections: EditorSelectionContext[],
): string | null {
  const chatStore = useAIChatStore.getState();
  const chatId = chatStore.currentChatId;
  const chat = chatId ? chatStore.chats.find((candidate) => candidate.id === chatId) : undefined;
  if (!chatId || !chat || chat.archivedAt) {
    return openNewAgentChat(undefined, editorSelections.length ? { editorSelections } : {});
  }

  if (editorSelections.length) {
    chatStore.actions.setPendingAgentLaunchRequest({
      chatId,
      agentId: chat.agentId,
      prompt: null,
      selectedBufferIds: [],
      selectedFilesPaths: [],
      editorSelections,
      mode: "append",
    });
  }
  return (
    openAgentWindowSession(chatId) ?? useBufferStore.getState().actions.openAgentBuffer(chatId)
  );
}

/** The active editor's selection as agent context, or null when nothing is selected. */
export function getActiveEditorSelectionContext(): EditorSelectionContext | null {
  const buffer = useBufferStore.getState().actions.getActiveBuffer();
  const selection = useEditorStateStore.getState().selection;
  if (!buffer || !isEditorContent(buffer) || !selection) return null;
  const languageId =
    buffer.languageOverride ?? buffer.language ?? getLanguageIdFromPath(buffer.path) ?? "text";
  return createEditorSelectionContext(buffer, selection, languageId);
}

/** Cmd+L: add the selection to the current chat. */
export function addActiveSelectionToAgentChat() {
  const context = getActiveEditorSelectionContext();
  return addEditorSelectionsToAgentChat(context ? [context] : []);
}

/** Cmd+Alt+L: start a new chat holding the selection. */
export function addActiveSelectionToNewAgentChat() {
  const context = getActiveEditorSelectionContext();
  return openNewAgentChat(undefined, context ? { editorSelections: [context] } : {});
}

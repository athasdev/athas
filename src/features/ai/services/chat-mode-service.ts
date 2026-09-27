import {
  getCodexSettings,
  saveCodexSettings,
} from "@/features/ai/integrations/codex/codex-integration-service";
import { selectChatAcpSession, selectChatAcpSessionId } from "@/features/ai/lib/acp-session-state";
import {
  findModeForIntent,
  getChatModeSource,
  getNextModeOption,
  isBuiltInChatMode,
  selectChatMode,
} from "@/features/ai/lib/composer-modes";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type {
  ChatModeSource,
  ComposerModeIntent,
  ComposerModeOption,
} from "@/features/ai/types/composer-mode.types";

/** The mode source of a chat, read outside React (palette commands, slash commands). */
export function readChatModeSource(chatId: string | null, agentId?: string): ChatModeSource {
  const state = useAIChatStore.getState();
  const resolvedAgentId =
    agentId ??
    state.chats.find((chat) => chat.id === chatId)?.agentId ??
    state.actions.getCurrentAgentId();
  return getChatModeSource({
    chatId,
    agentId: resolvedAgentId,
    builtInMode: selectChatMode(state, chatId),
    codexMode: getCodexSettings().collaborationMode,
    acpSession: selectChatAcpSession(state, chatId),
    acpSessionId: selectChatAcpSessionId(state, chatId),
  });
}

export function applyChatMode(source: ChatModeSource, modeId: string): boolean {
  if (!source.options.some((option) => option.id === modeId)) return false;
  const actions = useAIChatStore.getState().actions;
  switch (source.kind) {
    case "built-in":
      if (!isBuiltInChatMode(modeId)) return false;
      actions.setMode(modeId, source.chatId);
      return true;
    case "codex":
      saveCodexSettings({ ...getCodexSettings(), collaborationMode: modeId });
      return true;
    case "acp-config":
      if (!source.sessionId || !source.configOptionId) return false;
      void actions.changeSessionConfigOption(source.sessionId, source.configOptionId, modeId);
      return true;
    case "acp-mode":
      if (!source.sessionId) return false;
      void actions.changeSessionMode(source.sessionId, modeId);
      return true;
  }
}

/** Moves the chat to its next mode and returns it, or null when there is nothing to switch to. */
export function cycleChatMode(source: ChatModeSource): ComposerModeOption | null {
  const next = getNextModeOption(source);
  return next && applyChatMode(source, next.id) ? next : null;
}

export function applyChatModeIntent(
  source: ChatModeSource,
  intent: ComposerModeIntent,
): ComposerModeOption | null {
  const mode = findModeForIntent(source, intent);
  return mode && applyChatMode(source, mode.id) ? mode : null;
}

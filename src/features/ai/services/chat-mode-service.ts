import {
  getCodexSettings,
  saveCodexSettings,
} from "@/features/ai/integrations/codex/codex-integration-service";
import { selectComposerAcpSession } from "@/features/ai/services/acp-session-state";
import {
  findModeForIntent,
  getChatModeSource,
  getNextModeOption,
  isBuiltInChatMode,
  selectChatMode,
} from "@/features/ai/lib/composer-modes";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import type {
  ChatModeSource,
  ComposerModeIntent,
  ComposerModeOption,
} from "@/features/ai/types/composer-mode.types";

/** The mode source of a chat, read outside React (palette commands, slash commands). */
export function readChatModeSource(chatId: string | null, agentId?: string): ChatModeSource {
  const state = useAIChatStore.getState();
  const chat = chatId ? state.chats.find((candidate) => candidate.id === chatId) : undefined;
  const resolvedAgentId = agentId ?? chat?.agentId ?? state.actions.getCurrentAgentId();
  const acpTarget = {
    chatId,
    agentId: resolvedAgentId,
    workspacePath: chat?.workspacePath ?? useProjectStore.getState().rootFolderPath ?? null,
  };
  const acp = selectComposerAcpSession(state, acpTarget);
  return getChatModeSource({
    chatId,
    agentId: resolvedAgentId,
    builtInMode: selectChatMode(state, chatId),
    codexMode: getCodexSettings().collaborationMode,
    acpSession: acp.session,
    acpSessionId: acp.sessionId,
    acpTarget,
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
      if (!source.configOptionId) return false;
      if (source.target) {
        actions.changeAcpOption(source.target, { configId: source.configOptionId, value: modeId });
        return true;
      }
      if (!source.sessionId) return false;
      void actions.changeSessionConfigOption(source.sessionId, source.configOptionId, modeId);
      return true;
    case "acp-mode":
      if (source.target) {
        actions.changeAcpOption(source.target, { modeId });
        return true;
      }
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

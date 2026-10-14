import { useMemo } from "react";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { useComposerAcpSession } from "@/features/ai/hooks/use-composer-acp-session";
import { getChatModeSource, selectChatMode } from "@/features/ai/lib/composer-modes";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatModeSource } from "@/features/ai/types/composer-mode.types";

export function useChatModeSource(chatId: string | null, agentId: string): ChatModeSource {
  const builtInMode = useAIChatStore((state) => selectChatMode(state, chatId));
  const {
    session: acpSession,
    sessionId: acpSessionId,
    target: acpTarget,
  } = useComposerAcpSession(chatId, agentId);
  const { settings: codexSettings } = useCodexSettings();
  const codexMode = codexSettings.collaborationMode;

  return useMemo(
    () =>
      getChatModeSource({
        chatId,
        agentId,
        builtInMode,
        codexMode,
        acpSession,
        acpSessionId,
        acpTarget,
      }),
    [acpSession, acpSessionId, acpTarget, agentId, builtInMode, chatId, codexMode],
  );
}

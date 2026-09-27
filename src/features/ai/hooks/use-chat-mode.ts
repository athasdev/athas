import { useMemo } from "react";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { selectChatAcpSession, selectChatAcpSessionId } from "@/features/ai/lib/acp-session-state";
import { getChatModeSource, selectChatMode } from "@/features/ai/lib/composer-modes";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatModeSource } from "@/features/ai/types/composer-mode.types";

export function useChatModeSource(chatId: string | null, agentId: string): ChatModeSource {
  const builtInMode = useAIChatStore((state) => selectChatMode(state, chatId));
  const acpSession = useAIChatStore((state) => selectChatAcpSession(state, chatId));
  const acpSessionId = useAIChatStore((state) => selectChatAcpSessionId(state, chatId));
  const { settings: codexSettings } = useCodexSettings();
  const codexMode = codexSettings.collaborationMode;

  return useMemo(
    () => getChatModeSource({ chatId, agentId, builtInMode, codexMode, acpSession, acpSessionId }),
    [acpSession, acpSessionId, agentId, builtInMode, chatId, codexMode],
  );
}

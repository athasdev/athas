import { useCallback } from "react";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

interface NewAgentActionOptions {
  agentId?: AgentType;
  onOpen?: () => void;
}

export function useNewAgentAction(options: NewAgentActionOptions = {}) {
  return useCallback(() => {
    options.onOpen?.();
    openNewAgentChat(options.agentId);
  }, [options.agentId, options.onOpen]);
}

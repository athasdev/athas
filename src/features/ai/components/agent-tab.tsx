import { useEffect, useMemo } from "react";
import { useChatState } from "@/features/ai/hooks/use-chat-store";
import {
  createHarnessChatScopeId,
  DEFAULT_HARNESS_SESSION_KEY,
} from "@/features/ai/lib/chat-scope";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { Buffer } from "@/features/tabs/types/buffer";
import AIChat from "./chat/ai-chat";

interface AgentTabProps {
  buffer: Buffer;
}

export function AgentTab({ buffer }: AgentTabProps) {
  const buffers = useBufferStore.use.buffers();
  const { setAgentBufferTitle } = useBufferStore.use.actions();
  const sessionKey = buffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY;
  const scopeId = useMemo(() => createHarnessChatScopeId(sessionKey), [sessionKey]);
  const chatState = useChatState(scopeId);
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === chatState.currentChatId),
    [chatState.chats, chatState.currentChatId],
  );

  useEffect(() => {
    setAgentBufferTitle(sessionKey, currentChat?.title);
  }, [currentChat?.title, sessionKey, setAgentBufferTitle]);

  return (
    <div className="h-full w-full">
      <AIChat
        surface="harness"
        sessionKey={sessionKey}
        scopeId={scopeId}
        mode="chat"
        activeBuffer={buffer}
        buffers={buffers}
      />
    </div>
  );
}

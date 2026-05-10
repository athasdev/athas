import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { AgentContent, PaneContent } from "@/features/panes/types/pane-content";
import { useAIChatStore } from "@/features/ai/store/store";
import AIChat from "./chat/ai-chat";

interface AgentTabProps {
  buffer: AgentContent;
  isActive?: boolean;
}

export function AgentTab({ buffer, isActive = true }: AgentTabProps) {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const activeBuffer = buffers.find((b) => b.id === buffer.id) ?? (buffer as PaneContent);
  const activeAgentBuffer = activeBuffer.type === "agent" ? activeBuffer : buffer;
  const activeSessionId = activeAgentBuffer.sessionId;
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const hasChat = useAIChatStore((state) =>
    state.chats.some((chat) => chat.id === activeSessionId),
  );
  const chatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === activeSessionId)?.title,
  );

  useEffect(() => {
    if (hasChat) return;

    const chatId = createNewChat(selectedAgentId);
    updateBuffer({
      ...activeAgentBuffer,
      path: `agent://${chatId}`,
      sessionId: chatId,
    });
  }, [activeAgentBuffer, createNewChat, hasChat, selectedAgentId, updateBuffer]);

  useEffect(() => {
    if (!chatTitle || chatTitle === activeAgentBuffer.name) return;
    updateBuffer({ ...activeAgentBuffer, name: chatTitle });
  }, [activeAgentBuffer, chatTitle, updateBuffer]);

  return (
    <div className="h-full w-full">
      <AIChat
        mode="chat"
        chatId={activeSessionId}
        activeBuffer={activeBuffer}
        buffers={buffers}
        isActiveSurface={isActive}
      />
    </div>
  );
}

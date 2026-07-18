import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { AgentContent } from "@/features/panes/types/pane-content.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import AIChat from "./chat/ai-chat";

interface AgentTabProps {
  buffer: AgentContent;
  isActive?: boolean;
}

export function AgentTab({ buffer, isActive = true }: AgentTabProps) {
  const contextBuffers = useBufferStore((state) => (isActive ? state.buffers : []));
  const activeBuffer = useBufferStore(
    (state) => state.buffers.find((candidate) => candidate.id === buffer.id) ?? buffer,
  );
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const chatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === buffer.sessionId)?.title,
  );

  useEffect(() => {
    if (!chatTitle || chatTitle === buffer.name) return;
    updateBuffer({ ...buffer, name: chatTitle });
  }, [buffer, chatTitle, updateBuffer]);

  return (
    <div className="size-full overflow-hidden">
      <div className="mx-auto size-full max-w-4xl">
        <AIChat
          mode="chat"
          chatId={buffer.sessionId}
          activeBuffer={activeBuffer}
          buffers={contextBuffers}
          isActiveSurface={isActive}
        />
      </div>
    </div>
  );
}

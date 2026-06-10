import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { AgentContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import AIChat from "./chat/ai-chat";

interface AgentTabProps {
  buffer: AgentContent;
  isActive?: boolean;
}

export function AgentTab({ buffer, isActive = true }: AgentTabProps) {
  const buffers = useBufferStore.use.buffers();
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const chatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === buffer.sessionId)?.title,
  );
  const activeBuffer = buffers.find((b) => b.id === buffer.id) ?? (buffer as PaneContent);

  useEffect(() => {
    if (!chatTitle || chatTitle === buffer.name) return;
    updateBuffer({ ...buffer, name: chatTitle });
  }, [buffer, chatTitle, updateBuffer]);

  return (
    <div className="h-full w-full overflow-hidden">
      <div className="mx-auto h-full w-full max-w-4xl">
        <AIChat
          mode="chat"
          chatId={buffer.sessionId}
          activeBuffer={activeBuffer}
          buffers={buffers}
          isActiveSurface={isActive}
        />
      </div>
    </div>
  );
}

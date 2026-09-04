import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { AgentContent } from "@/features/panes/types/pane-content.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import AIChat from "./chat/ai-chat";
import { AgentWindowPlaceholder } from "@/features/ai/detached/agent-window-placeholder";
import { useAgentWindowStore } from "@/features/ai/detached/agent-window.store";

interface AgentTabProps {
  buffer: AgentContent;
  isActive?: boolean;
}

export function AgentTab({ buffer, isActive = true }: AgentTabProps) {
  const windowStatus = useAgentWindowStore.use.status();
  const contextBuffers = useBufferStore((state) => (isActive ? state.buffers : []));
  const activeBuffer = useBufferStore(
    (state) => state.buffers.find((candidate) => candidate.id === buffer.id) ?? buffer,
  );
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const chatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === buffer.sessionId)?.title,
  );
  const tabTitle = chatTitle || "New Session";

  useEffect(() => {
    if (tabTitle === buffer.name) return;
    updateBuffer({ ...buffer, name: tabTitle });
  }, [buffer, tabTitle, updateBuffer]);

  if (windowStatus !== "attached") return <AgentWindowPlaceholder />;

  return (
    <div className="size-full overflow-hidden">
      <AIChat
        mode="chat"
        surfaceId={`agent-session:${buffer.sessionId}`}
        chatId={buffer.sessionId}
        activeBuffer={activeBuffer}
        buffers={contextBuffers}
        isActiveSurface={isActive}
      />
    </div>
  );
}

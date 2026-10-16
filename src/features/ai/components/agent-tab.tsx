import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useOpenBuffersIgnoringText } from "@/features/editor/hooks/use-buffer-text";
import { useKeymapStore } from "@/features/keymaps/stores/keymaps.store";
import type { AgentContent } from "@/features/panes/types/pane-content.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import AIChat from "./chat/ai-chat";
import { AgentWindowPlaceholder } from "@/features/ai/detached/agent-window-placeholder";
import { useAgentWindowStore } from "@/features/ai/detached/stores/agent-window.store";
import { isAgentWindow } from "@/features/ai/detached/services/agent-window-service";
import { SessionHeaderTools } from "../session-panel/components/session-header-tools";
import { AGENT_SESSION_CHAT_ATTRIBUTE } from "../session-panel/services/session-links";

interface AgentTabProps {
  buffer: AgentContent;
  isActive?: boolean;
}

export function AgentTab({ buffer, isActive = true }: AgentTabProps) {
  const windowStatus = useAgentWindowStore((state) => state.sessions[buffer.sessionId]);
  const contextBuffers = useOpenBuffersIgnoringText(isActive);
  const activeBuffer = useBufferStore(
    (state) => state.buffers.find((candidate) => candidate.id === buffer.id) ?? buffer,
  );
  const updateBuffer = useBufferStore.use.actions().updateBuffer;
  const setContext = useKeymapStore.use.actions().setContext;
  const chatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === buffer.sessionId)?.title,
  );
  const tabTitle = chatTitle || "New Session";
  const hasToolPanel = !isAgentWindow();

  useEffect(() => {
    if (tabTitle === buffer.name) return;
    updateBuffer({ ...buffer, name: tabTitle });
  }, [buffer, tabTitle, updateBuffer]);

  useEffect(() => {
    if (!isActive || !hasToolPanel) return;
    setContext("agentSessionFocus", true);
    return () => setContext("agentSessionFocus", false);
  }, [hasToolPanel, isActive, setContext]);

  if (windowStatus) return <AgentWindowPlaceholder chatId={buffer.sessionId} />;

  return (
    <div
      className="size-full overflow-hidden"
      {...(hasToolPanel ? { [AGENT_SESSION_CHAT_ATTRIBUTE]: buffer.sessionId } : {})}
    >
      <AIChat
        mode="chat"
        surfaceId={`agent-session:${buffer.sessionId}`}
        chatId={buffer.sessionId}
        activeBuffer={activeBuffer}
        buffers={contextBuffers}
        isActiveSurface={isActive}
        headerActions={hasToolPanel ? <SessionHeaderTools chatId={buffer.sessionId} /> : undefined}
      />
    </div>
  );
}

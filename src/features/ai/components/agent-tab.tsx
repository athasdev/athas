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
import { AgentSessionLayout } from "../session-panel/components/agent-session-layout";
import { SessionPanelHeaderActions } from "../session-panel/components/session-panel-header-actions";

interface AgentTabProps {
  buffer: AgentContent;
  paneId?: string;
  isActive?: boolean;
}

export function AgentTab({ buffer, paneId, isActive = true }: AgentTabProps) {
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
  const workspacePath = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === buffer.sessionId)?.workspacePath,
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

  const chat = (
    <AIChat
      mode="chat"
      surfaceId={`agent-session:${buffer.sessionId}`}
      chatId={buffer.sessionId}
      activeBuffer={activeBuffer}
      buffers={contextBuffers}
      isActiveSurface={isActive}
      headerActions={
        hasToolPanel ? <SessionPanelHeaderActions chatId={buffer.sessionId} /> : undefined
      }
    />
  );

  return (
    <div className="size-full overflow-hidden">
      {hasToolPanel ? (
        <AgentSessionLayout
          chatId={buffer.sessionId}
          agentBufferId={buffer.id}
          paneId={paneId}
          workingDirectory={workspacePath ?? undefined}
        >
          {chat}
        </AgentSessionLayout>
      ) : (
        chat
      )}
    </div>
  );
}

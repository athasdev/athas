import { useCallback } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import { openTerminalAgent } from "@/features/ai/lib/terminal-agent-terminal";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { ImageContent } from "@/features/ai/types/ai-chat.types";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { useToast } from "@/features/layout/contexts/toast-context";

const EMPTY_PROJECT_FILES: FileEntry[] = [];

interface AgentLaunchInputProps {
  autoFocus?: boolean;
  surfaceId?: string;
}

export function AgentLaunchInput({
  autoFocus = false,
  surfaceId = "agent-launch-input",
}: AgentLaunchInputProps) {
  const buffers = useBufferStore((state) => state.buffers);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const allProjectFiles = useFileSystemStore(
    (state) => state.projectFilesCache?.files ?? EMPTY_PROJECT_FILES,
  );
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const createNewChat = useAIChatStore((state) => state.actions.createNewChat);
  const setSelectedAgentId = useAIChatStore((state) => state.actions.setSelectedAgentId);
  const setPendingAgentLaunchRequest = useAIChatStore(
    (state) => state.actions.setPendingAgentLaunchRequest,
  );
  const composerContext = useComposerContextSelection();
  const { showToast } = useToast();
  const { selectedBufferIds, selectedFilesPaths } = composerContext.inputProps;

  const submit = useCallback(
    (prompt: string, images?: ImageContent[]) => {
      if (isTerminalAgent(selectedAgentId)) {
        if (images?.length) {
          showToast({
            message: "Terminal agents do not accept pasted images here. Choose a chat agent.",
            type: "error",
          });
          return { accepted: false };
        }
        openTerminalAgent(selectedAgentId);
        return { accepted: true };
      }

      const nextPrompt = prompt.trim();
      if (!nextPrompt && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(selectedAgentId, useAIChatStore.getState().hasApiKey);
      if (!access.accepted) {
        showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
        return access;
      }

      const chatId = createNewChat(selectedAgentId, { activate: false });
      setPendingAgentLaunchRequest({
        chatId,
        agentId: selectedAgentId,
        prompt: nextPrompt,
        images,
        selectedBufferIds: Array.from(selectedBufferIds),
        selectedFilesPaths: Array.from(selectedFilesPaths),
        editorSelections: composerContext.inputProps.selectedEditorContexts,
      });
      openAgentBuffer(chatId);
      return { accepted: true };
    },
    [
      createNewChat,
      openAgentBuffer,
      selectedAgentId,
      selectedBufferIds,
      selectedFilesPaths,
      composerContext.inputProps.selectedEditorContexts,
      setPendingAgentLaunchRequest,
      showToast,
    ],
  );

  return (
    <AIChatInputBar
      surfaceId={surfaceId}
      buffers={buffers}
      allProjectFiles={allProjectFiles}
      currentAgentId={selectedAgentId}
      isTyping={false}
      streamingMessageId={null}
      queuedMessages={[]}
      {...composerContext.inputProps}
      isActiveSurface
      presentation="initial"
      autoFocus={autoFocus}
      onAgentChange={setSelectedAgentId}
      onSendMessage={submit}
      onInterruptAndSend={submit}
      onMoveQueuedMessage={() => {}}
      onRemoveQueuedMessage={() => {}}
      onStopStreaming={() => {}}
    />
  );
}

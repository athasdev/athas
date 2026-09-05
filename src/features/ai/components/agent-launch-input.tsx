import { useCallback } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import { openTerminalAgent } from "@/features/ai/lib/terminal-agent-terminal";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";

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
  const { selectedBufferIds, selectedFilesPaths } = composerContext.inputProps;

  const submit = useCallback(
    (prompt: string) => {
      if (isTerminalAgent(selectedAgentId)) {
        openTerminalAgent(selectedAgentId);
        return { accepted: true };
      }

      const nextPrompt = prompt.trim();
      if (!nextPrompt) return { accepted: false };

      const chatId = createNewChat(selectedAgentId, { activate: false });
      setPendingAgentLaunchRequest({
        chatId,
        agentId: selectedAgentId,
        prompt: nextPrompt,
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

import { useCallback } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useOpenBuffersIgnoringText } from "@/features/editor/hooks/use-buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { ImageContent } from "@/features/ai/types/ai-chat.types";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { useToast } from "@/utils/toast";
import { launchAgentInProject } from "@/features/ai/services/agent-project-navigation";

const EMPTY_PROJECT_FILES: FileEntry[] = [];

interface AgentLaunchInputProps {
  autoFocus?: boolean;
  surfaceId?: string;
  /** The open project the agent starts in when it is not this surface's own. */
  targetProjectId?: string | null;
}

export function AgentLaunchInput({
  autoFocus = false,
  surfaceId = "agent-launch-input",
  targetProjectId = null,
}: AgentLaunchInputProps) {
  const buffers = useOpenBuffersIgnoringText();
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const allProjectFiles = useFileSystemStore(
    (state) => state.projectFilesCache?.files ?? EMPTY_PROJECT_FILES,
  );
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const setSelectedAgentId = useAIChatStore((state) => state.actions.setSelectedAgentId);
  const composerContext = useComposerContextSelection();
  const { showToast } = useToast();
  const { selectedBufferIds, selectedFilesPaths } = composerContext.inputProps;

  const submit = useCallback(
    (prompt: string, images?: ImageContent[]) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(selectedAgentId, useAIChatStore.getState().hasApiKey);
      if (!access.accepted) {
        showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
        return access;
      }

      // Attached files and selections belong to this project, so they stay behind.
      const keepsContext = !targetProjectId;
      void launchAgentInProject(targetProjectId, {
        agentId: selectedAgentId,
        prompt: nextPrompt,
        images,
        selectedBufferIds: keepsContext ? Array.from(selectedBufferIds) : [],
        selectedFilesPaths: keepsContext ? Array.from(selectedFilesPaths) : [],
        editorSelections: keepsContext ? composerContext.inputProps.selectedEditorContexts : [],
      });
      return { accepted: true };
    },
    [
      selectedAgentId,
      selectedBufferIds,
      selectedFilesPaths,
      composerContext.inputProps.selectedEditorContexts,
      showToast,
      targetProjectId,
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
      size="roomy"
      autoFocus={autoFocus}
      onAgentChange={setSelectedAgentId}
      onTerminalChatCreated={openAgentBuffer}
      onSendMessage={submit}
      onInterruptAndSend={submit}
      onMoveQueuedMessage={() => {}}
      onUpdateQueuedMessage={() => {}}
      onRemoveQueuedMessage={() => {}}
      onSendQueuedMessageNow={() => {}}
      onStopStreaming={() => {}}
    />
  );
}

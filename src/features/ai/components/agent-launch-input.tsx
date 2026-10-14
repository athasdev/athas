import { useCallback, useEffect } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useOpenBuffersIgnoringText } from "@/features/editor/hooks/use-buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type { ImageContent } from "@/features/ai/types/ai-chat.types";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { getAgentAccessMessage } from "@/features/ai/services/agent-turn-runner";
import { getProviderAccessFromMap } from "@/features/ai/stores/ai-chat/provider-actions";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
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
  const providerId = useSettingsStore((state) => state.settings.aiProviderId);
  const subscription = useAuthStore((state) => state.subscription);
  const checkApiKey = useAIChatStore((state) => state.actions.checkApiKey);

  useEffect(() => {
    if (selectedAgentId === "custom") void checkApiKey(providerId);
  }, [selectedAgentId, providerId, subscription, checkApiKey]);
  const { selectedBufferIds, selectedFilesPaths } = composerContext.inputProps;

  const submit = useCallback(
    (prompt: string, images?: ImageContent[]) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(
        selectedAgentId,
        getProviderAccessFromMap(providerId, useAIChatStore.getState().providerApiKeys),
        providerId,
      );
      if (!access.accepted) {
        showToast({
          message: getAgentAccessMessage(selectedAgentId, providerId, access.error),
          type: "error",
        });
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
      providerId,
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

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
import { useAgentEnvironment } from "@/features/ai/cloud-agents/hooks/use-agent-environment";
import { toCloudAgentId } from "@/features/ai/cloud-agents/services/cloud-environment";
import { launchCloudAgent } from "@/features/ai/cloud-agents/services/cloud-session";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

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
  const { hasCloudAgents } = useProFeature();
  const activeProjectPath = useProjectStore((state) => state.rootFolderPath ?? null);
  const targetProjectPath = useWorkspaceTabsStore((state) =>
    targetProjectId
      ? (state.projectTabs.find((project) => project.id === targetProjectId)?.path ?? null)
      : activeProjectPath,
  );
  const environmentDraftKey = `${surfaceId}:${targetProjectPath ?? ""}`;
  const environment = useAgentEnvironment({ chatId: null, draftKey: environmentDraftKey });
  const isCloud = hasCloudAgents && environment.kind === "cloud";

  useEffect(() => {
    if (selectedAgentId === "custom") void checkApiKey(providerId);
  }, [selectedAgentId, providerId, subscription, checkApiKey]);
  const { selectedBufferIds, selectedFilesPaths } = composerContext.inputProps;

  const submit = useCallback(
    (prompt: string, images?: ImageContent[]) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt && !images?.length) return { accepted: false };
      if (isCloud) {
        const error = !toCloudAgentId(selectedAgentId)
          ? "Cloud runs use Claude Code or Codex. Switch the agent to run this in the cloud."
          : images?.length
            ? "Cloud runs take text only. Remove the images to send."
            : !environment.repo || !environment.branch
              ? "Pick the repository and branch the cloud run starts from."
              : null;
        if (error) {
          showToast({ message: error, type: "error" });
          return { accepted: false, error };
        }
        void launchCloudAgent(targetProjectId, {
          agentId: selectedAgentId,
          prompt: nextPrompt,
          repo: environment.repo,
          branch: environment.branch,
        }).then((launched) => {
          if (launched?.result.error) showToast({ message: launched.result.error, type: "error" });
        });
        return { accepted: true };
      }
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
      environment.branch,
      environment.repo,
      isCloud,
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
      environmentDraftKey={environmentDraftKey}
      environmentWorkspacePath={targetProjectPath}
    />
  );
}

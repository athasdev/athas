import { useCallback, useState } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
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
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(new Set());
  const [selectedFilesPaths, setSelectedFilesPaths] = useState<Set<string>>(new Set());

  const submit = useCallback(
    async (prompt: string) => {
      if (isTerminalAgent(selectedAgentId)) {
        openTerminalAgent(selectedAgentId);
        return;
      }

      const nextPrompt = prompt.trim();
      if (!nextPrompt) return;

      const chatId = createNewChat(selectedAgentId, { activate: false });
      setPendingAgentLaunchRequest({
        chatId,
        agentId: selectedAgentId,
        prompt: nextPrompt,
        selectedBufferIds: Array.from(selectedBufferIds),
        selectedFilesPaths: Array.from(selectedFilesPaths),
      });
      openAgentBuffer(chatId);
    },
    [
      createNewChat,
      openAgentBuffer,
      selectedAgentId,
      selectedBufferIds,
      selectedFilesPaths,
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
      queueCount={0}
      selectedBufferIds={selectedBufferIds}
      selectedFilesPaths={selectedFilesPaths}
      onToggleBufferSelection={(bufferId) =>
        setSelectedBufferIds((current) => {
          const next = new Set(current);
          if (next.has(bufferId)) next.delete(bufferId);
          else next.add(bufferId);
          return next;
        })
      }
      onToggleFileSelection={(filePath) =>
        setSelectedFilesPaths((current) => {
          const next = new Set(current);
          if (next.has(filePath)) next.delete(filePath);
          else next.add(filePath);
          return next;
        })
      }
      onSetSelectedBufferIds={setSelectedBufferIds}
      onSetSelectedFilesPaths={setSelectedFilesPaths}
      isActiveSurface
      presentation="initial"
      autoFocus={autoFocus}
      onAgentChange={setSelectedAgentId}
      onSendMessage={submit}
      onStopStreaming={() => {}}
    />
  );
}

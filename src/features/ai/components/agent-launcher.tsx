import { useCallback, useEffect, useState } from "react";
import AIChatInputBar from "@/features/ai/components/input/chat-input-bar";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { openTerminalAgent } from "@/features/ai/lib/terminal-agent-terminal";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Command from "@/ui/command";

const EMPTY_PROJECT_FILES: FileEntry[] = [];

interface AgentLaunchInputProps {
  active?: boolean;
  autoFocus?: boolean;
  onRequestClose?: () => void;
  surfaceId?: string;
}

export function AgentLaunchInput({
  active = true,
  autoFocus = false,
  onRequestClose,
  surfaceId = "agent-launcher",
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

  const close = useCallback(() => {
    onRequestClose?.();
  }, [onRequestClose]);

  useEffect(() => {
    if (active) return;
    setSelectedBufferIds(new Set());
    setSelectedFilesPaths(new Set());
  }, [active]);

  const submit = useCallback(
    async (prompt: string) => {
      if (isTerminalAgent(selectedAgentId)) {
        openTerminalAgent(selectedAgentId);
        close();
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
      close();
    },
    [
      close,
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
      key={active ? "active" : "inactive"}
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
      isActiveSurface={active}
      presentation="initial"
      autoFocus={autoFocus}
      onAgentChange={setSelectedAgentId}
      onSendMessage={submit}
      onStopStreaming={() => {}}
    />
  );
}

export function AgentLauncher() {
  const isVisible = useUIState((state) => state.isAgentLauncherVisible);
  const setIsVisible = useUIState((state) => state.setIsAgentLauncherVisible);
  const close = useCallback(() => setIsVisible(false), [setIsVisible]);

  return (
    <Command
      isVisible={isVisible}
      onClose={close}
      className="w-[min(680px,calc(100vw-24px))] overflow-visible border-0 bg-transparent p-0 shadow-none"
    >
      <AgentLaunchInput active={isVisible} autoFocus onRequestClose={close} />
    </Command>
  );
}

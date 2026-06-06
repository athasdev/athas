import { ClockCounterClockwiseIcon as History } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Input from "@/ui/input";
import {
  PaneChip,
  PaneIconButton,
  paneHeaderClassName,
  paneTitleClassName,
} from "@/features/panes/components/pane-chrome";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../store/store";
import ChatHistoryDropdown from "../history/sidebar";
import { AgentSelector } from "../selectors/agent-selector";

function EditableChatTitle({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      onUpdateTitle(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="h-6 rounded-lg border-border/80 bg-primary-bg px-2.5 py-1 ui-text-xs font-medium focus:border-accent/40 focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="block max-w-full cursor-pointer truncate rounded-lg px-2 py-1 ui-text-xs font-medium transition-colors hover:bg-hover"
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

interface ChatHeaderProps {
  chatId?: string | null;
  onDeleteChat?: (chatId: string, event: React.MouseEvent) => void;
}

export function ChatHeader({ chatId, onDeleteChat }: ChatHeaderProps) {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const workspacePath = useProjectStore((state) => state.rootFolderPath || null);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const isChatHistoryVisible = useAIChatStore((state) => state.isChatHistoryVisible);
  const setIsChatHistoryVisible = useAIChatStore((state) => state.setIsChatHistoryVisible);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const switchToChat = useAIChatStore((state) => state.switchToChat);

  const { openSettingsDialog } = useUIState();
  const effectiveChatId = chatId ?? currentChatId;
  const currentChat = chats.find((chat) => chat.id === effectiveChatId);
  const currentAgentId = currentChat?.agentId ?? selectedAgentId;
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const currentHeaderIconId = currentAgentId === "custom" ? aiProviderId : currentAgentId;
  const workspaceChats = useMemo(
    () => filterChatsByWorkspace(chats, workspacePath),
    [chats, workspacePath],
  );

  return (
    <div className={cn("relative z-[10020]", paneHeaderClassName())}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <PaneChip className="size-6 justify-center px-0">
            <ProviderIcon providerId={currentHeaderIconId} size={12} />
          </PaneChip>
          {effectiveChatId ? (
            <EditableChatTitle
              title={currentChat ? currentChat.title : "New Chat"}
              onUpdateTitle={(title) => updateChatTitle(effectiveChatId, title)}
            />
          ) : (
            <span className={cn(paneTitleClassName(), "truncate")}>New Chat</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <PaneIconButton
          type="button"
          ref={historyButtonRef}
          onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
          tooltip="Chat History"
          tooltipSide="bottom"
          aria-label="Toggle chat history"
        >
          <History />
        </PaneIconButton>

        <AgentSelector variant="header" onOpenSettings={() => openSettingsDialog("ai")} />
      </div>

      <ChatHistoryDropdown
        isOpen={isChatHistoryVisible}
        onClose={() => setIsChatHistoryVisible(false)}
        chats={workspaceChats}
        currentChatId={effectiveChatId}
        onSwitchToChat={switchToChat}
        onDeleteChat={onDeleteChat ?? (() => {})}
        triggerRef={historyButtonRef}
      />
    </div>
  );
}

import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  ClockCounterClockwiseIcon as History,
  MagnifyingGlassIcon as Search,
  PlusIcon as Plus,
  XIcon as X,
} from "@/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import Input, { InlineRenameInput } from "@/ui/input";
import {
  PaneChip,
  paneHeaderClassName,
  paneTitleClassName,
} from "@/features/panes/components/pane-chrome";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../stores/ai-chat.store";
import ChatHistoryDropdown from "../history/chat-history-dropdown";
import { useNewAgentAction } from "../../hooks/use-new-agent-action";

function EditableChatTitle({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  const handleSave = (nextTitle: string) => {
    if (nextTitle !== title) {
      onUpdateTitle(nextTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <InlineRenameInput
        value={editValue}
        onValueChange={setEditValue}
        onSubmit={handleSave}
        onCancel={handleCancel}
        width="content"
        className="min-w-24 max-w-52"
        aria-label={`Rename ${title}`}
      />
    );
  }

  return (
    <span
      className="block max-w-full cursor-pointer truncate rounded-md px-2 py-1 ui-text-sm font-medium transition-colors hover:bg-accent"
      onClick={() => setIsEditing(true)}
      title="Click to rename session"
    >
      {title}
    </span>
  );
}

interface ChatHeaderProps {
  chatId?: string | null;
  onDeleteChat?: (chatId: string, event: React.MouseEvent) => void;
  onSwitchChat: (chatId: string) => void;
  isMessageSearchOpen: boolean;
  messageSearchQuery: string;
  onToggleMessageSearch: () => void;
  onCloseMessageSearch: () => void;
  onMessageSearchQueryChange: (query: string) => void;
  messageSearchMatchCount: number;
  activeMessageSearchIndex: number;
  onPreviousMessageSearchMatch: () => void;
  onNextMessageSearchMatch: () => void;
}

export function ChatHeader({
  chatId,
  onDeleteChat,
  onSwitchChat,
  isMessageSearchOpen,
  messageSearchQuery,
  onToggleMessageSearch,
  onCloseMessageSearch,
  onMessageSearchQueryChange,
  messageSearchMatchCount,
  activeMessageSearchIndex,
  onPreviousMessageSearchMatch,
  onNextMessageSearchMatch,
}: ChatHeaderProps) {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const workspacePath = useProjectStore((state) => state.rootFolderPath || null);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const [isChatHistoryVisible, setIsChatHistoryVisible] = useState(false);
  const updateChatTitle = useAIChatStore((state) => state.actions.updateChatTitle);
  const setChatArchived = useAIChatStore((state) => state.actions.setChatArchived);

  const handleNewAgent = useNewAgentAction();
  const effectiveChatId = chatId ?? currentChatId;
  const currentChat = chats.find((chat) => chat.id === effectiveChatId);
  const currentAgentId = currentChat?.agentId ?? selectedAgentId;
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const messageSearchInputRef = useRef<HTMLInputElement>(null);
  const currentHeaderIconId = currentAgentId === "custom" ? aiProviderId : currentAgentId;
  const workspaceChats = useMemo(
    () => filterChatsByWorkspace(chats, workspacePath),
    [chats, workspacePath],
  );
  const hasSearchQuery = messageSearchQuery.trim().length > 0;
  const hasMessageSearchMatches = messageSearchMatchCount > 0;
  const messageSearchPosition =
    hasSearchQuery && hasMessageSearchMatches
      ? `${activeMessageSearchIndex + 1}/${messageSearchMatchCount}`
      : hasSearchQuery
        ? "0/0"
        : "";

  useEffect(() => {
    if (!isMessageSearchOpen) return;
    requestAnimationFrame(() => messageSearchInputRef.current?.focus());
  }, [isMessageSearchOpen]);

  return (
    <div className="relative z-10020 bg-background">
      <div className={paneHeaderClassName()}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <PaneChip className="size-6 justify-center px-0">
              <ProviderIcon providerId={currentHeaderIconId} size={12} />
            </PaneChip>
            {effectiveChatId ? (
              <EditableChatTitle
                title={currentChat ? currentChat.title : "New Session"}
                onUpdateTitle={(title) => updateChatTitle(effectiveChatId, title)}
              />
            ) : (
              <span className={cn(paneTitleClassName(), "truncate")}>New Session</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onToggleMessageSearch}
            active={isMessageSearchOpen}
            tooltip="Search messages"
            tooltipSide="bottom"
            aria-label="Search messages"
          >
            <Search />
          </Button>

          <Button
            type="button"
            ref={historyButtonRef}
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
            tooltip="Agent History"
            tooltipSide="bottom"
            aria-label="Toggle agent history"
          >
            <History />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleNewAgent}
            tooltip="New Agent"
            tooltipSide="bottom"
            aria-label="New Agent"
          >
            <Plus />
          </Button>
        </div>
      </div>

      {isMessageSearchOpen ? (
        <div className="flex items-center gap-1.5 border-border/50 border-t px-1.5 py-1">
          <Input
            ref={messageSearchInputRef}
            value={messageSearchQuery}
            onChange={(event) => onMessageSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCloseMessageSearch();
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  onPreviousMessageSearchMatch();
                } else {
                  onNextMessageSearchMatch();
                }
              }
            }}
            placeholder="Search messages"
            size="xs"
            variant="ghost"
            leftIcon={Search}
            className="h-7 bg-surface/45"
          />

          <span className="min-w-10 shrink-0 text-right text-subtle-foreground ui-text-sm">
            {messageSearchPosition}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!hasMessageSearchMatches}
            onClick={onPreviousMessageSearchMatch}
            tooltip="Previous match"
            aria-label="Previous search match"
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!hasMessageSearchMatches}
            onClick={onNextMessageSearchMatch}
            tooltip="Next match"
            aria-label="Next search match"
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCloseMessageSearch}
            tooltip="Close search"
            aria-label="Close message search"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <ChatHistoryDropdown
        isOpen={isChatHistoryVisible}
        onClose={() => setIsChatHistoryVisible(false)}
        chats={workspaceChats}
        currentChatId={effectiveChatId}
        onSwitchToChat={(nextChatId) => {
          setIsChatHistoryVisible(false);
          onSwitchChat(nextChatId);
        }}
        onSetChatArchived={setChatArchived}
        onDeleteChat={onDeleteChat ?? (() => {})}
        triggerRef={historyButtonRef}
      />
    </div>
  );
}

import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  ClockCounterClockwiseIcon as History,
  MagnifyingGlassIcon as Search,
  XIcon as X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import {
  PaneChip,
  paneHeaderClassName,
  paneTitleClassName,
} from "@/features/panes/components/pane-chrome";
import { chatMiniIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../stores/ai-chat.store";
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
        className="h-6 border-border/80 bg-primary-bg px-2.5 py-1 ui-text-sm font-medium focus:border-accent/40 focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="block max-w-full cursor-pointer truncate rounded-[var(--app-radius-control-sm)] px-2 py-1 ui-text-sm font-medium transition-colors hover:bg-hover"
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
    <div className="relative z-[10020] bg-primary-bg">
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
            compact
            onClick={onToggleMessageSearch}
            active={isMessageSearchOpen}
            tooltip="Search messages"
            tooltipSide="bottom"
            aria-label="Search messages"
            className={chatMiniIconButtonClassName()}
          >
            <Search />
          </Button>

          <Button
            type="button"
            ref={historyButtonRef}
            variant="ghost"
            compact
            onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
            tooltip="Agent History"
            tooltipSide="bottom"
            aria-label="Toggle agent history"
            className={chatMiniIconButtonClassName()}
          >
            <History />
          </Button>

          <AgentSelector
            variant="header"
            onOpenSettings={() => openSettingsDialog("ai")}
            triggerClassName={chatMiniIconButtonClassName()}
          />
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
            className="h-7 bg-secondary-bg/45"
          />

          <span className="min-w-10 shrink-0 text-right text-text-lighter ui-text-sm">
            {messageSearchPosition}
          </span>

          <Button
            type="button"
            variant="ghost"
            compact
            disabled={!hasMessageSearchMatches}
            onClick={onPreviousMessageSearchMatch}
            tooltip="Previous match"
            aria-label="Previous search match"
            className={chatMiniIconButtonClassName()}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            compact
            disabled={!hasMessageSearchMatches}
            onClick={onNextMessageSearchMatch}
            tooltip="Next match"
            aria-label="Next search match"
            className={chatMiniIconButtonClassName()}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            compact
            onClick={onCloseMessageSearch}
            tooltip="Close search"
            aria-label="Close message search"
            className={chatMiniIconButtonClassName()}
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
        onSwitchToChat={switchToChat}
        onDeleteChat={onDeleteChat ?? (() => {})}
        triggerRef={historyButtonRef}
      />
    </div>
  );
}

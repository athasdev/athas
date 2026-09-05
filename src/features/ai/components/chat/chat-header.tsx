import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  MagnifyingGlassIcon as Search,
  PlusIcon as Plus,
  XIcon as X,
  WindowExpandIcon,
  ArrowLeftIcon,
} from "@/ui/icons";
import { useEffect, useMemo, useRef } from "react";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { useProjectStore } from "@/features/window/stores/project.store";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { useAIChatStore } from "../../stores/ai-chat.store";
import ChatHistoryDropdown from "../history/chat-history-dropdown";
import { useNewAgentAction } from "../../hooks/use-new-agent-action";
import { isAgentWindow, openAgentInNewWindow } from "@/features/ai/detached/agent-window-service";
import { requestWindowClose } from "@/features/window/utils/request-window-close";

interface ChatHeaderProps {
  chatId?: string | null;
  onDeleteChat?: (chatId: string) => void;
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
  const setChatArchived = useAIChatStore((state) => state.actions.setChatArchived);

  const effectiveChatId = chatId ?? currentChatId;
  const standalone = isAgentWindow();
  const currentChat = chats.find((chat) => chat.id === effectiveChatId);
  const currentAgentId = currentChat?.agentId ?? selectedAgentId;
  const handleNewAgent = useNewAgentAction({ agentId: currentAgentId });
  const messageSearchInputRef = useRef<HTMLInputElement>(null);
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
    <div className="relative z-10020 shrink-0">
      {isMessageSearchOpen ? (
        <PaneContentHeader
          surface="transparent"
          separated={false}
          context={
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
              variant="ghost"
              leftIcon={Search}
            />
          }
          detail={messageSearchPosition}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                iconOnly
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
                iconOnly
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
                iconOnly
                onClick={onCloseMessageSearch}
                tooltip="Close search"
                aria-label="Close message search"
              >
                <X />
              </Button>
            </>
          }
        />
      ) : (
        <PaneContentHeader
          surface="transparent"
          separated={false}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={onToggleMessageSearch}
                tooltip="Search messages"
                aria-label="Search messages"
              >
                <Search />
              </Button>

              {!standalone && (
                <ChatHistoryDropdown
                  chats={workspaceChats}
                  currentChatId={effectiveChatId}
                  onSwitchToChat={onSwitchChat}
                  onSetChatArchived={setChatArchived}
                  onDeleteChat={onDeleteChat ?? (() => {})}
                />
              )}

              {!standalone && (
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  onClick={handleNewAgent}
                  tooltip="New Agent"
                  commandId="workbench.agentLauncher"
                  aria-label="New Agent"
                >
                  <Plus />
                </Button>
              )}
              {effectiveChatId && (
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  onClick={() =>
                    standalone ? requestWindowClose() : void openAgentInNewWindow(effectiveChatId)
                  }
                  tooltip={standalone ? "Return agent to main window" : "Open agent in new window"}
                  aria-label={
                    standalone ? "Return agent to main window" : "Open agent in new window"
                  }
                >
                  {standalone ? <ArrowLeftIcon /> : <WindowExpandIcon />}
                </Button>
              )}
            </>
          }
        />
      )}
    </div>
  );
}

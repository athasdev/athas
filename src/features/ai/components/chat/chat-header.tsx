import { shareAgent } from "@/features/sharing/services/open-share";
import { openChatTranscript } from "@/features/ai/services/chat-transcript-service";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { UploadIcon } from "@/ui/icons";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  SearchIcon,
  SidebarRightIcon,
  WindowExpandIcon,
  XIcon,
  DotsIcon,
  FileIcon,
} from "@/ui/icons";
import { useEffect, useMemo, useRef } from "react";
import { selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { useAIChatStore } from "../../stores/ai-chat.store";
import ChatHistoryDropdown from "../history/chat-history-dropdown";
import { selectAcpAgentStatus } from "@/features/ai/lib/acp-session-state";
import { canBrowseAgentSessions, openAgentSessions } from "@/features/ai/lib/open-agent-sessions";
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
  const { openSidebarView } = useSidebarPaneController();
  const isAgentPanelOpen = useUIState(
    (state) => state.isRightSidebarVisible && state.activeRightSidebarView === "agent",
  );
  const currentChat = chats.find((chat) => chat.id === effectiveChatId);
  const hasMessages = useAIChatStore((state) =>
    effectiveChatId ? (state.messagesByChat[effectiveChatId]?.length ?? 0) > 0 : false,
  );
  const currentAgentId = currentChat?.agentId ?? selectedAgentId;
  const handleNewAgent = useNewAgentAction({ agentId: currentAgentId });
  const canBrowseSessions = useAIChatStore((state) =>
    canBrowseAgentSessions(
      selectAcpAgentStatus(state, currentAgentId, workspacePath),
      currentAgentId,
    ),
  );
  const messageSearchInputRef = useRef<HTMLInputElement>(null);
  const workspaceChats = useMemo(
    () => selectAgentSessions(chats, { workspacePath, keepIds: [effectiveChatId] }),
    [chats, effectiveChatId, workspacePath],
  );
  const archivedChats = useMemo(
    () => selectAgentSessions(chats, { workspacePath, includeArchived: "only" }),
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
              leftIcon={SearchIcon}
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
                <ArrowUpIcon />
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
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                onClick={onCloseMessageSearch}
                tooltip="Close search"
                aria-label="Close message search"
              >
                <XIcon />
              </Button>
            </>
          }
        />
      ) : (
        <PaneContentHeader
          surface="transparent"
          separated={false}
          title={currentChat?.title || "Agent"}
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
                <SearchIcon />
              </Button>

              {!standalone && (
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  active={isAgentPanelOpen}
                  aria-pressed={isAgentPanelOpen}
                  onClick={() => openSidebarView("agent", { paneLevel: "edge" })}
                  tooltip={isAgentPanelOpen ? "Hide agent panel" : "Show agent panel"}
                  aria-label={isAgentPanelOpen ? "Hide agent panel" : "Show agent panel"}
                >
                  <SidebarRightIcon />
                </Button>
              )}

              {!standalone && (
                <ChatHistoryDropdown
                  chats={workspaceChats}
                  archivedChats={archivedChats}
                  currentChatId={effectiveChatId}
                  onSwitchToChat={onSwitchChat}
                  onSetChatArchived={setChatArchived}
                  onDeleteChat={onDeleteChat ?? (() => {})}
                  onBrowseAgentSessions={
                    canBrowseSessions ? () => openAgentSessions(currentAgentId) : undefined
                  }
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
                  <PlusIcon />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      aria-label="Conversation actions"
                      tooltip="Conversation actions"
                    />
                  }
                >
                  <DotsIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" size="default">
                  <DropdownMenuItem
                    disabled={!effectiveChatId}
                    onClick={() => effectiveChatId && void openChatTranscript(effectiveChatId)}
                  >
                    <FileIcon />
                    Open conversation as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!hasMessages}
                    onClick={() => shareAgent(effectiveChatId ?? undefined)}
                  >
                    <UploadIcon />
                    Share agent to web
                  </DropdownMenuItem>
                  {effectiveChatId && (
                    <DropdownMenuItem
                      onClick={() =>
                        standalone
                          ? requestWindowClose()
                          : void openAgentInNewWindow(effectiveChatId)
                      }
                    >
                      {standalone ? <ArrowLeftIcon /> : <WindowExpandIcon />}
                      {standalone ? "Return agent to main window" : "Open agent in new window"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      )}
    </div>
  );
}

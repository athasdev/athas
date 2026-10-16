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
  SearchIcon,
  WindowExpandIcon,
  XIcon,
  DotsIcon,
  FileIcon,
} from "@/ui/icons";
import { type ReactNode, useEffect, useRef } from "react";
import { PaneActions, PaneHeader, PaneTitle } from "@/ui/pane";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { useAIChatStore } from "../../stores/ai-chat.store";
import {
  isAgentWindow,
  openAgentInNewWindow,
} from "@/features/ai/detached/services/agent-window-service";
import { requestWindowClose } from "@/features/window/services/request-window-close";

interface ChatHeaderProps {
  chatId?: string | null;
  /** Session controls from the host, such as its tools. */
  sessionActions?: ReactNode;
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
  sessionActions,
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
  const effectiveChatId = chatId ?? currentChatId;
  const currentChatTitle = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === effectiveChatId)?.title,
  );
  const standalone = isAgentWindow();
  const hasMessages = useAIChatStore((state) =>
    effectiveChatId ? (state.messagesByChat[effectiveChatId]?.length ?? 0) > 0 : false,
  );
  const messageSearchInputRef = useRef<HTMLInputElement>(null);
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
        <PaneHeader>
          <div className="flex min-w-0 flex-1 items-center gap-chrome">
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
            {messageSearchPosition ? (
              <span className="shrink-0 tabular-nums text-subtle-foreground">
                {messageSearchPosition}
              </span>
            ) : null}
          </div>
          <PaneActions reveal={false}>
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
          </PaneActions>
        </PaneHeader>
      ) : (
        <PaneHeader>
          <PaneTitle>{currentChatTitle || "Agent"}</PaneTitle>
          <PaneActions>
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

            {sessionActions}

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
                      standalone ? requestWindowClose() : void openAgentInNewWindow(effectiveChatId)
                    }
                  >
                    {standalone ? <ArrowLeftIcon /> : <WindowExpandIcon />}
                    {standalone ? "Return agent to main window" : "Open agent in new window"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </PaneActions>
        </PaneHeader>
      )}
    </div>
  );
}

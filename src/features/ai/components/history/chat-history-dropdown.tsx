import { useMemo } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  DotsIcon,
  HistoryIcon,
  PinIcon,
  TrashIcon,
} from "@/ui/icons";
import { useMenuSearch } from "@/ui/menu-search";
import { AgentSessionIcon } from "../icons/agent-session-icon";

interface ChatHistoryDropdownProps {
  /** Active sessions, already scoped and ordered by `selectAgentSessions`. */
  chats: Chat[];
  archivedChats: Chat[];
  currentChatId: string | null;
  onSwitchToChat: (chatId: string) => void;
  onSetChatArchived: (chatId: string, archived: boolean) => void;
  onDeleteChat: (chatId: string) => void;
}

function SessionRow({
  chat,
  isCurrent,
  onSwitchToChat,
  onSetChatArchived,
  onDeleteChat,
}: {
  chat: Chat;
  isCurrent: boolean;
} & Pick<ChatHistoryDropdownProps, "onSwitchToChat" | "onSetChatArchived" | "onDeleteChat">) {
  return (
    <DropdownMenuItem
      onClick={() => onSwitchToChat(chat.id)}
      trailingAction={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="chrome"
                iconOnly
                aria-label={`Actions for ${chat.title}`}
              />
            }
          >
            <DotsIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSetChatArchived(chat.id, !chat.archivedAt)}>
              {chat.archivedAt ? <ArrowCounterClockwiseIcon /> : <ArchiveIcon />}
              {chat.archivedAt ? "Restore session" : "Archive session"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDeleteChat(chat.id)}>
              <TrashIcon />
              Delete session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <AgentSessionIcon session={chat} size={14} />
      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      {chat.isPinned ? <PinIcon className="shrink-0 text-subtle-foreground" /> : null}
      {isCurrent ? (
        <CheckIcon className="shrink-0 text-primary" />
      ) : (
        <span className="shrink-0 text-subtle-foreground">
          {getRelativeTime(chat.lastMessageAt)}
        </span>
      )}
    </DropdownMenuItem>
  );
}

export default function ChatHistoryDropdown({
  chats,
  archivedChats,
  currentChatId,
  onSwitchToChat,
  onSetChatArchived,
  onDeleteChat,
}: ChatHistoryDropdownProps) {
  const search = useMenuSearch();
  const matches = (chat: Chat) => [chat.title, chat.agentId || "custom"];
  const filteredChats = search.filter(chats, matches);
  const filteredArchived = search.filter(archivedChats, matches);
  const rowProps = { onSwitchToChat, onSetChatArchived, onDeleteChat };
  const groups = useMemo(() => {
    const pinned = filteredChats.filter((chat) => chat.isPinned);
    const recent = filteredChats.filter((chat) => !chat.isPinned);
    return { pinned, recent };
  }, [filteredChats]);

  return (
    <DropdownMenu {...search.menuProps}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Agent History"
            aria-label="Agent history"
          />
        }
      >
        <HistoryIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="wide" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search agent history..."
          autoFocus
        />
        <DropdownMenuViewport>
          {chats.length === 0 && archivedChats.length === 0 ? (
            <DropdownMenuEmpty>No agent history yet</DropdownMenuEmpty>
          ) : filteredChats.length === 0 && filteredArchived.length === 0 ? (
            <DropdownMenuEmpty>No matching sessions</DropdownMenuEmpty>
          ) : null}

          {groups.pinned.length > 0 ? (
            <>
              <DropdownMenuLabel>Pinned</DropdownMenuLabel>
              {groups.pinned.map((chat) => (
                <SessionRow
                  key={chat.id}
                  chat={chat}
                  isCurrent={chat.id === currentChatId}
                  {...rowProps}
                />
              ))}
            </>
          ) : null}

          {groups.recent.length > 0 ? (
            <>
              {groups.pinned.length > 0 ? <DropdownMenuLabel>Recent</DropdownMenuLabel> : null}
              {groups.recent.map((chat) => (
                <SessionRow
                  key={chat.id}
                  chat={chat}
                  isCurrent={chat.id === currentChatId}
                  {...rowProps}
                />
              ))}
            </>
          ) : null}

          {filteredArchived.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArchiveIcon />
                <span className="min-w-0 flex-1 truncate">Archived</span>
                <span className="shrink-0 text-subtle-foreground">{filteredArchived.length}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent size="wide">
                {filteredArchived.map((chat) => (
                  <SessionRow
                    key={chat.id}
                    chat={chat}
                    isCurrent={chat.id === currentChatId}
                    {...rowProps}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

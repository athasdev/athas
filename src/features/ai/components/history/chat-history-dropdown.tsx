import { useDeferredValue, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  ArrowCounterClockwiseIcon as Restore,
  CheckIcon as Check,
  ClockCounterClockwiseIcon as History,
  TrashIcon as Trash,
} from "@/ui/icons";
import { matchesSearchQuery } from "@/utils/search-match";
import { ProviderIcon } from "../icons/provider-icons";

interface ChatHistoryDropdownProps {
  chats: Chat[];
  currentChatId: string | null;
  onSwitchToChat: (chatId: string) => void;
  onSetChatArchived: (chatId: string, archived: boolean) => void;
  onDeleteChat: (chatId: string) => void;
}

export default function ChatHistoryDropdown({
  chats,
  currentChatId,
  onSwitchToChat,
  onSetChatArchived,
  onDeleteChat,
}: ChatHistoryDropdownProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filteredChats = chats.filter((chat) =>
    matchesSearchQuery(deferredSearchQuery, [chat.title, chat.agentId || "custom"]),
  );

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearchQuery("")}>
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
        <History />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 min-w-72">
        <DropdownMenuSearch
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search agent history..."
          autoFocus
        />

        {chats.length === 0 ? (
          <DropdownMenuItem disabled>No agent history yet</DropdownMenuItem>
        ) : filteredChats.length === 0 ? (
          <DropdownMenuItem disabled>No matching sessions</DropdownMenuItem>
        ) : (
          filteredChats.map((chat) => {
            const isCurrent = chat.id === currentChatId;

            return (
              <DropdownMenuSub key={chat.id}>
                <DropdownMenuSubTrigger>
                  <ProviderIcon providerId={chat.agentId || "custom"} size={14} />
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                  <span className="shrink-0 text-subtle-foreground">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                  {isCurrent ? <Check className="shrink-0 text-primary" /> : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onSwitchToChat(chat.id)}>
                    {isCurrent ? <Check /> : <ProviderIcon providerId={chat.agentId} size={14} />}
                    {isCurrent ? "Current session" : "Open session"}
                  </DropdownMenuItem>
                  {chat.archivedAt ? (
                    <DropdownMenuItem onClick={() => onSetChatArchived(chat.id, false)}>
                      <Restore />
                      Restore session
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDeleteChat(chat.id)}>
                    <Trash />
                    Delete session
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

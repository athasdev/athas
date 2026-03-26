import { Check, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { ProviderIcon } from "../icons/provider-icons";

interface ChatHistoryDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  currentChatId: string | null;
  onSwitchToChat: (chatId: string) => void;
  onDeleteChat: (chatId: string, event: React.MouseEvent) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const DROPDOWN_WIDTH = 340;

export default function ChatHistoryDropdown({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onSwitchToChat,
  onDeleteChat,
  triggerRef,
}: ChatHistoryDropdownProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    return chats.filter((chat) => chat.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [chats, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  return (
    <Dropdown
      isOpen={isOpen}
      anchorRef={triggerRef}
      anchorAlign="end"
      onClose={onClose}
      className="flex flex-col overflow-hidden rounded-2xl p-0"
      style={{ width: `${DROPDOWN_WIDTH}px` }}
    >
      <div className="bg-secondary-bg px-2 py-2">
        <Input
          ref={searchRef}
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          variant="ghost"
          className="w-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {chats.length === 0 ? (
          <div className="p-3 text-center text-text-lighter text-xs italic">No chat history</div>
        ) : filteredChats.length === 0 ? (
          <div className="p-3 text-center text-text-lighter text-xs italic">
            No chats match "{searchQuery}"
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredChats.map((chat) => (
              <div
                key={chat.id}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover",
                  chat.id === currentChatId && "bg-selected",
                )}
              >
                <div className="flex shrink-0 items-center">
                  {chat.id === currentChatId ? (
                    <Check className="text-success" />
                  ) : (
                    <ProviderIcon
                      providerId={chat.agentId || "custom"}
                      size={12}
                      className="text-text-lighter"
                    />
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSwitchToChat(chat.id);
                    onClose();
                  }}
                  className="h-auto min-w-0 flex-1 justify-start flex-col items-start gap-0.5 px-0 py-0 text-left hover:bg-transparent"
                >
                  <span
                    className={cn(
                      "block w-full truncate text-left text-xs",
                      chat.id === currentChatId
                        ? "font-medium text-text"
                        : "text-text-lighter hover:text-text",
                    )}
                  >
                    {chat.title}
                  </span>
                  <span className="block w-full select-none text-left text-[10px] text-text-lighter">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat(chat.id, e);
                  }}
                  className="ml-auto rounded text-text-lighter opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400"
                  title="Delete chat"
                  aria-label="Delete chat"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dropdown>
  );
}

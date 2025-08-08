import { MessageSquare, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import type { ChatHistoryModalProps } from "./types";
import { getRelativeTime } from "./utils";

export default function ChatHistoryModal({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onSwitchToChat,
  onDeleteChat,
}: ChatHistoryModalProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg border border-border bg-primary-bg shadow-xl">
        <div className="flex select-none items-center justify-between border-border border-b p-3">
          <h3 className="font-medium text-sm text-text">Chat History</h3>
          <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-hover">
            <X size={14} className="text-text-lighter" />
          </button>
        </div>

        <div className="border-border border-b p-3">
          <div className="relative">
            <Search
              size={12}
              className="-translate-y-1/2 absolute top-1/2 left-2 transform text-text-lighter"
            />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-border bg-secondary-bg py-1 pr-2 pl-7 text-text text-xs focus:border-text-lighter focus:outline-none"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {filteredChats.length === 0 ? (
            <div className="py-8 text-center text-text-lighter">
              <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{searchQuery ? "No matching chats" : "No chat history"}</p>
            </div>
          ) : (
            <div>
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => {
                    onSwitchToChat(chat.id);
                    onClose();
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center justify-between border-border border-b p-2 transition-colors last:border-b-0",
                    chat.id === currentChatId ? "bg-blue-500/20" : "hover:bg-hover",
                  )}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="truncate font-medium text-text text-xs">{chat.title}</div>
                    <div className="select-none text-text-lighter text-xs">
                      {getRelativeTime(chat.lastMessageAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => onDeleteChat(chat.id, e)}
                    className="rounded p-1 opacity-0 transition-all hover:bg-red-500/20 group-hover:opacity-100"
                    title="Delete chat"
                  >
                    <Trash2 size={10} className="text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { MessageSquare, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../utils/cn";
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

  const filteredChats = chats.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-medium text-[var(--text-color)]">Chat History</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--hover-color)] rounded transition-colors"
          >
            <X size={14} className="text-[var(--text-lighter)]" />
          </button>
        </div>

        <div className="p-3 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)]"
            />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-xs bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded focus:outline-none focus:border-[var(--text-lighter)] text-[var(--text-color)]"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-lighter)]">
              <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{searchQuery ? "No matching chats" : "No chat history"}</p>
            </div>
          ) : (
            <div>
              {filteredChats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => {
                    onSwitchToChat(chat.id);
                    onClose();
                  }}
                  className={cn(
                    "flex items-center justify-between p-2 cursor-pointer transition-colors group border-b border-[var(--border-color)] last:border-b-0",
                    chat.id === currentChatId ? "bg-blue-500/20" : "hover:bg-[var(--hover-color)]",
                  )}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="text-xs text-[var(--text-color)] truncate font-medium">
                      {chat.title}
                    </div>
                    <div className="text-xs text-[var(--text-lighter)]">
                      {getRelativeTime(chat.lastMessageAt)}
                    </div>
                  </div>
                  <button
                    onClick={e => onDeleteChat(chat.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
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

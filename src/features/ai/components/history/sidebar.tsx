import { Check, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { ProviderIcon } from "../icons/provider-icons";

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

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
const ESTIMATED_HEIGHT = 400;

export default function ChatHistoryDropdown({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onSwitchToChat,
  onDeleteChat,
  triggerRef,
}: ChatHistoryDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    return chats.filter((chat) => chat.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [chats, searchQuery]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const safeWidth = Math.min(DROPDOWN_WIDTH, window.innerWidth - viewportPadding * 2);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp = availableBelow < Math.min(ESTIMATED_HEIGHT, 280) && availableAbove > availableBelow;
    const maxHeight = Math.max(
      220,
      Math.min(ESTIMATED_HEIGHT, openUp ? availableAbove - 6 : availableBelow - 6),
    );
    const measuredHeight = dropdownRef.current?.getBoundingClientRect().height ?? ESTIMATED_HEIGHT;
    const visibleHeight = Math.min(maxHeight, measuredHeight);

    const desiredLeft = rect.right - safeWidth;
    const left = Math.max(
      viewportPadding,
      Math.min(desiredLeft, window.innerWidth - safeWidth - viewportPadding),
    );
    const top = openUp ? Math.max(viewportPadding, rect.top - visibleHeight - 6) : rect.bottom + 6;

    setPosition({ left, top, width: safeWidth, maxHeight });
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition, searchQuery, chats.length]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const handleReposition = () => updatePosition();

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, onClose, triggerRef, updatePosition]);

  if (!isOpen || !position) return null;

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[10030] flex flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 backdrop-blur-sm"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
      }}
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
                    <Check size={12} className="text-success" />
                  ) : (
                    <ProviderIcon
                      providerId={chat.agentId || "custom"}
                      size={12}
                      className="text-text-lighter"
                    />
                  )}
                </div>

                <button
                  onClick={() => {
                    onSwitchToChat(chat.id);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                >
                  <span
                    className={cn(
                      "truncate text-xs",
                      chat.id === currentChatId
                        ? "font-medium text-text"
                        : "text-text-lighter hover:text-text",
                    )}
                  >
                    {chat.title}
                  </span>
                  <span className="select-none text-[10px] text-text-lighter">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat(chat.id, e);
                  }}
                  className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-text-lighter opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                  title="Delete chat"
                  aria-label="Delete chat"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

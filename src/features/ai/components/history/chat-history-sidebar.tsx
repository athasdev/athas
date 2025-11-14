import { useEffect, useRef, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { ChatHistoryModalProps } from "@/features/ai/types/ai-chat";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";

interface ChatHistorySidebarProps extends Omit<ChatHistoryModalProps, "formatTime"> {}

export default function ChatHistorySidebar({
  isOpen,
  onClose,
  chats,
  onSwitchToChat,
  onDeleteChat,
}: ChatHistorySidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setSelectedIndex(0);
      setSearchQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < filteredChats.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredChats[selectedIndex]) {
            onSwitchToChat(filteredChats[selectedIndex].id);
            onClose();
          }
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, selectedIndex, filteredChats]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (resultsRef.current && filteredChats.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, filteredChats.length]);

  return (
    <Command isVisible={isOpen} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search chat history..."
        />
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredChats.length === 0 ? (
          <CommandEmpty>No chat history</CommandEmpty>
        ) : (
          filteredChats.map((chat, index) => (
            <CommandItem
              key={chat.id}
              onClick={() => {
                onSwitchToChat(chat.id);
                onClose();
              }}
              isSelected={index === selectedIndex}
              className="px-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{chat.title}</div>
                <div className="select-none text-[10px] text-text-lighter">
                  {getRelativeTime(chat.lastMessageAt)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id, e);
                }}
                className="ml-2 flex-shrink-0 rounded px-1 py-0.5 text-red-500 text-xs opacity-0 transition-all hover:bg-red-500/20 group-hover:opacity-100"
                title="Delete chat"
              >
                ×
              </button>
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}

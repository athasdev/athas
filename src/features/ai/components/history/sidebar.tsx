import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { AGENT_OPTIONS, type ChatHistoryModalProps } from "@/features/ai/types/ai-chat";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";

// Get short agent label for badge
const getAgentLabel = (agentId: string | undefined): string => {
  if (!agentId) return "API";
  const agent = AGENT_OPTIONS.find((a) => a.id === agentId);
  if (!agent) return "API";
  // Return short labels
  switch (agentId) {
    case "claude-code":
      return "Claude";
    case "gemini-cli":
      return "Gemini";
    case "codex-cli":
      return "Codex";
    case "custom":
      return "API";
    default:
      return agent.name.split(" ")[0];
  }
};

// Get badge color based on agent
const getAgentColor = (agentId: string | undefined): string => {
  switch (agentId) {
    case "claude-code":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "gemini-cli":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "codex-cli":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "kimi-cli":
      return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    case "opencode":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "qwen-code":
      return "bg-pink-500/20 text-pink-400 border-pink-500/30";
    default:
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  }
};

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
              className="group px-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs">{chat.title}</span>
                  <span
                    className={`shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none ${getAgentColor(chat.agentId)}`}
                  >
                    {getAgentLabel(chat.agentId)}
                  </span>
                </div>
                <div className="select-none text-[10px] text-text-lighter">
                  {getRelativeTime(chat.lastMessageAt)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id, e);
                }}
                className="ml-2 flex size-5 shrink-0 items-center justify-center rounded text-text-lighter opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                title="Delete chat"
                aria-label="Delete chat"
              >
                <Trash2 size={12} />
              </button>
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}

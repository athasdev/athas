import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers3,
  Play,
  Split,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getChatSummaryCounts } from "@/features/ai/lib/chat-context";
import { buildChatHistoryTree } from "@/features/ai/lib/chat-history-tree";
import { getChatLineageLabel, getChatLineagePath } from "@/features/ai/lib/chat-lineage";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { AGENT_OPTIONS, type ChatHistoryModalProps } from "@/features/ai/types/ai-chat";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { cn } from "@/utils/cn";

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
    case "pi":
      return "Pi";
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
    case "pi":
      return "bg-violet-500/20 text-violet-400 border-violet-500/30";
    default:
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  }
};

interface ChatHistorySidebarProps
  extends Omit<ChatHistoryModalProps, "formatTime" | "onSwitchToChat"> {
  onContinueToChat: (chatId: string) => void;
  onForkChat: (chatId: string) => Promise<void>;
}

export default function ChatHistorySidebar({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onContinueToChat,
  onForkChat,
  onDeleteChat,
}: ChatHistorySidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [decisionChatId, setDecisionChatId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [collapsedChatIds, setCollapsedChatIds] = useState<Set<string>>(new Set());

  const treeItems = useMemo(
    () => buildChatHistoryTree(chats, searchQuery, collapsedChatIds, currentChatId),
    [chats, collapsedChatIds, currentChatId, searchQuery],
  );
  const chatTitleMap = new Map(chats.map((chat) => [chat.id, chat.title]));
  const activeLineagePath = useMemo(
    () => new Set(getChatLineagePath(chats, currentChatId)),
    [chats, currentChatId],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setSelectedIndex(0);
      setDecisionChatId(null);
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
          setSelectedIndex((prev) => (prev < treeItems.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (treeItems[selectedIndex]) {
            const selectedChat = treeItems[selectedIndex].chat;
            if (selectedChat.id === currentChatId) {
              onContinueToChat(selectedChat.id);
              onClose();
              return;
            }

            setDecisionChatId((current) => (current === selectedChat.id ? null : selectedChat.id));
          }
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentChatId, isOpen, onClose, onContinueToChat, selectedIndex, treeItems]);

  useEffect(() => {
    setSelectedIndex(0);
    setDecisionChatId(null);
  }, [searchQuery]);

  useEffect(() => {
    if (activeLineagePath.size === 0) {
      return;
    }

    setCollapsedChatIds((current) => {
      const next = new Set(current);
      for (const chatId of activeLineagePath) {
        next.delete(chatId);
      }
      return next.size === current.size ? current : next;
    });
  }, [activeLineagePath]);

  useEffect(() => {
    if (resultsRef.current && treeItems.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, treeItems.length]);

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
        {treeItems.length === 0 ? (
          <CommandEmpty>No chat history</CommandEmpty>
        ) : (
          treeItems.map(
            (
              {
                chat,
                depth,
                hasChildren,
                childCount,
                descendantCount,
                isCollapsed,
                isCurrent,
                isOnActivePath,
              },
              index,
            ) => {
              const summaryCounts = getChatSummaryCounts(chat);

              return (
                <CommandItem
                  key={chat.id}
                  onClick={() => {
                    if (chat.id === currentChatId) {
                      onContinueToChat(chat.id);
                      onClose();
                      return;
                    }

                    setDecisionChatId((current) => (current === chat.id ? null : chat.id));
                  }}
                  isSelected={index === selectedIndex}
                  className={cn(
                    "group px-3 py-1.5",
                    isCurrent && "bg-blue-500/10",
                    !isCurrent && isOnActivePath && "bg-blue-500/5",
                  )}
                >
                  <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 14}px` }}>
                    <div className="flex items-center gap-1.5">
                      {hasChildren ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsedChatIds((current) => {
                              const next = new Set(current);
                              if (next.has(chat.id)) {
                                next.delete(chat.id);
                              } else {
                                next.add(chat.id);
                              }
                              return next;
                            });
                          }}
                          className="flex size-4 shrink-0 items-center justify-center rounded text-text-lighter hover:bg-hover hover:text-text"
                          aria-label={isCollapsed ? "Expand branch" : "Collapse branch"}
                        >
                          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </button>
                      ) : (
                        <span className="block w-4 shrink-0" />
                      )}
                      <span className="truncate text-xs">{chat.title}</span>
                      <span
                        className={`shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none ${getAgentColor(chat.agentId)}`}
                      >
                        {getAgentLabel(chat.agentId)}
                      </span>
                      <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-lighter leading-none">
                        {getChatLineageLabel(chat)}
                      </span>
                      {chat.lineageDepth > 0 ? (
                        <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-lighter leading-none">
                          d{chat.lineageDepth}
                        </span>
                      ) : null}
                      {hasChildren ? (
                        <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-lighter leading-none">
                          {childCount}/{descendantCount}
                        </span>
                      ) : null}
                      {summaryCounts.compaction > 0 ? (
                        <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-lighter leading-none">
                          <span className="inline-flex items-center gap-1">
                            <Layers3 size={9} />C{summaryCounts.compaction}
                          </span>
                        </span>
                      ) : null}
                      {summaryCounts.branch > 0 ? (
                        <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-lighter leading-none">
                          <span className="inline-flex items-center gap-1">
                            <GitBranch size={9} />B{summaryCounts.branch}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <div className="select-none text-[10px] text-text-lighter">
                      {getRelativeTime(chat.lastMessageAt)}
                    </div>
                    {chat.parentChatId ? (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-text-lighter">
                        <GitBranch size={10} />
                        <span className="truncate">
                          From {chatTitleMap.get(chat.parentChatId) ?? "previous session"}
                        </span>
                      </div>
                    ) : null}
                    {decisionChatId === chat.id ? (
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onContinueToChat(chat.id);
                            onClose();
                          }}
                          className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300 hover:bg-blue-500/15"
                        >
                          <Play size={10} />
                          Continue here
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onForkChat(chat.id);
                            onClose();
                          }}
                          className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-2 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                        >
                          <Split size={10} />
                          Fork new session
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDecisionChatId(null);
                          }}
                          className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-2 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : null}
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
              );
            },
          )
        )}
      </CommandList>
    </Command>
  );
}

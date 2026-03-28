import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Layers3, Play, Search, Split, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getChatSummaryCounts } from "@/features/ai/lib/chat-context";
import { buildChatHistoryTree } from "@/features/ai/lib/chat-history-tree";
import { getChatLineagePath } from "@/features/ai/lib/chat-lineage";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { AGENT_OPTIONS, type ChatHistoryModalProps } from "@/features/ai/types/ai-chat";
import { cn } from "@/utils/cn";

const getAgentLabel = (agentId: string | undefined): string => {
  if (!agentId) return "API";
  const agent = AGENT_OPTIONS.find((a) => a.id === agentId);
  if (!agent) return "API";
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

interface ChatHistorySidebarProps extends Omit<
  ChatHistoryModalProps,
  "formatTime" | "onSwitchToChat"
> {
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
    if (activeLineagePath.size === 0) return;

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
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex, treeItems.length]);

  return (
    <AnimatePresence>
      {isOpen && (
        <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
          <DialogPrimitive.Portal>
            <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24">
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm"
                />
              </DialogPrimitive.Overlay>

              <DialogPrimitive.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="relative flex max-h-[75vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-primary-bg/95 shadow-2xl focus:outline-none"
                >
                  <div className="flex items-center gap-3 border-b border-border/30 px-5 py-4">
                    <Search className="h-4 w-4 text-text-lighter" />
                    <input
                      ref={inputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Find past sessions..."
                      className="flex-1 bg-transparent text-sm text-text placeholder-text-lighter outline-none"
                    />
                    <button
                      onClick={onClose}
                      className="rounded-full p-1 text-text-lighter hover:bg-hover hover:text-text transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div
                    ref={resultsRef}
                    className="custom-scrollbar-thin flex-1 overflow-y-auto p-2"
                  >
                    {treeItems.length === 0 ? (
                      <div className="py-12 text-center text-sm text-text-lighter">
                        No sessions found
                      </div>
                    ) : (
                      treeItems.map(
                        (
                          {
                            chat,
                            depth,
                            hasChildren,
                            descendantCount,
                            isCollapsed,
                            isCurrent,
                          },
                          index,
                        ) => {
                          const summaryCounts = getChatSummaryCounts(chat);
                          const isSelected = index === selectedIndex;
                          const isDecision = decisionChatId === chat.id;

                          return (
                            <div
                              key={chat.id}
                              onClick={() => {
                                if (chat.id === currentChatId) {
                                  onContinueToChat(chat.id);
                                  onClose();
                                  return;
                                }
                                setDecisionChatId((current) =>
                                  current === chat.id ? null : chat.id,
                                );
                                setSelectedIndex(index);
                              }}
                              className={cn(
                                "group relative mb-0.5 flex cursor-pointer flex-col gap-1 rounded-xl px-4 py-3 transition-colors",
                                isSelected ? "bg-hover/80" : "hover:bg-hover/40",
                                isCurrent && "bg-accent/5 hover:bg-accent/10",
                              )}
                            >
                              {isCurrent && (
                                <div className="absolute left-0 top-1/2 h-8 -translate-y-1/2 w-1 rounded-r-full bg-accent/60" />
                              )}

                              <div
                                className="flex items-start gap-2"
                                style={{ paddingLeft: `${depth * 16}px` }}
                              >
                                {hasChildren ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCollapsedChatIds((current) => {
                                        const next = new Set(current);
                                        if (next.has(chat.id)) next.delete(chat.id);
                                        else next.add(chat.id);
                                        return next;
                                      });
                                    }}
                                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-lighter hover:bg-hover hover:text-text transition-colors"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight size={14} />
                                    ) : (
                                      <ChevronDown size={14} />
                                    )}
                                  </button>
                                ) : (
                                  <span className="block w-4 shrink-0" />
                                )}

                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "truncate text-[13px] font-medium transition-colors",
                                        isCurrent ? "text-accent" : "text-text",
                                      )}
                                    >
                                      {chat.title}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-text-lighter whitespace-nowrap">
                                      {getRelativeTime(chat.lastMessageAt)}
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-lighter">
                                    <span className="flex items-center gap-1.5 opacity-80">
                                      <span>{getAgentLabel(chat.agentId)}</span>
                                    </span>

                                    {chat.lineageDepth > 0 && (
                                      <>
                                        <span className="opacity-30">&bull;</span>
                                        <span className="opacity-80">
                                          Depth {chat.lineageDepth}
                                        </span>
                                      </>
                                    )}

                                    {hasChildren && (
                                      <>
                                        <span className="opacity-30">&bull;</span>
                                        <span className="opacity-80">
                                          {descendantCount} variants
                                        </span>
                                      </>
                                    )}

                                    {summaryCounts.compaction > 0 && (
                                      <>
                                        <span className="opacity-30">&bull;</span>
                                        <span className="flex items-center gap-1 opacity-80">
                                          <Layers3 size={10} /> {summaryCounts.compaction}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteChat(chat.id, e);
                                  }}
                                  className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-md text-text-lighter opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {isDecision && (
                                <div
                                  className="mt-2 flex items-center gap-2"
                                  style={{ paddingLeft: `${depth * 16 + 24}px` }}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onContinueToChat(chat.id);
                                      onClose();
                                    }}
                                    className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
                                  >
                                    <Play size={12} fill="currentColor" />
                                    Continue Session
                                  </button>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      await onForkChat(chat.id);
                                      onClose();
                                    }}
                                    className="flex items-center gap-1.5 rounded-lg bg-secondary-bg px-3 py-1.5 text-xs font-medium text-text-lighter hover:bg-hover hover:text-text transition-colors"
                                  >
                                    <Split size={12} />
                                    Fork from here
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        },
                      )
                    )}
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </AnimatePresence>
  );
}

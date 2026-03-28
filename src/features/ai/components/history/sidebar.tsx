import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat";
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

export default function ChatHistoryDropdown({
  isOpen,
  onClose,
  chats,
  currentChatId,
  onSwitchToChat,
  onDeleteChat,
  triggerRef,
}: ChatHistoryDropdownProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return chats;
    return chats.filter((chat) => {
      const titleMatch = chat.title.toLowerCase().includes(query);
      const providerMatch = (chat.agentId ?? "custom").toLowerCase().includes(query);
      return titleMatch || providerMatch;
    });
  }, [chats, searchQuery]);

  const handleClose = () => {
    onClose();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery("");
    setSelectedIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          handleClose();
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredChats.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          if (filteredChats[selectedIndex]) {
            event.preventDefault();
            onSwitchToChat(filteredChats[selectedIndex].id);
            handleClose();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filteredChats, isOpen, onSwitchToChat, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!resultsRef.current || filteredChats.length === 0) return;
    const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [filteredChats.length, selectedIndex]);

  return (
    <AnimatePresence>
      {isOpen && (
        <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
          <DialogPrimitive.Portal>
            <div className="fixed inset-0 z-[10030] flex items-start justify-center px-4 pt-16 sm:pt-24">
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm"
                />
              </DialogPrimitive.Overlay>

              <DialogPrimitive.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="relative flex max-h-[75vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-border/40 bg-primary-bg/95 shadow-2xl focus:outline-none"
                >
                  <div className="flex items-center gap-3 border-b border-border/30 px-5 py-4">
                    <Search className="size-4 text-text-lighter" />
                    <input
                      ref={inputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Find past chats..."
                      className="flex-1 bg-transparent text-sm text-text placeholder-text-lighter outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-full p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                      aria-label="Close chat history"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div
                    ref={resultsRef}
                    className="custom-scrollbar-thin flex-1 overflow-y-auto p-2"
                  >
                    {chats.length === 0 ? (
                      <div className="py-12 text-center text-sm text-text-lighter">
                        No chat history yet
                      </div>
                    ) : filteredChats.length === 0 ? (
                      <div className="py-12 text-center text-sm text-text-lighter">
                        No chats match "{searchQuery}"
                      </div>
                    ) : (
                      filteredChats.map((chat, index) => {
                        const isCurrent = chat.id === currentChatId;
                        const isSelected = index === selectedIndex;

                        return (
                          <div
                            key={chat.id}
                            onClick={() => {
                              onSwitchToChat(chat.id);
                              handleClose();
                            }}
                            className={cn(
                              "group relative mb-0.5 flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 transition-colors",
                              isSelected ? "bg-hover/80" : "hover:bg-hover/40",
                              isCurrent && "bg-accent/5 hover:bg-accent/10",
                            )}
                          >
                            {isCurrent && (
                              <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-accent/60" />
                            )}

                            <div className="mt-0.5 flex shrink-0 items-center justify-center">
                              {isCurrent ? (
                                <Check className="size-4 text-accent" />
                              ) : (
                                <ProviderIcon
                                  providerId={chat.agentId || "custom"}
                                  size={13}
                                  className="text-text-lighter"
                                />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "truncate text-[13px] font-medium transition-colors",
                                    isCurrent ? "text-accent" : "text-text",
                                  )}
                                >
                                  {chat.title}
                                </span>
                                <span className="shrink-0 text-[10px] whitespace-nowrap text-text-lighter">
                                  {getRelativeTime(chat.lastMessageAt)}
                                </span>
                              </div>

                              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-lighter">
                                <span className="opacity-80">
                                  {(chat.agentId || "custom").replace(/-/g, " ")}
                                </span>
                                {isCurrent && (
                                  <>
                                    <span className="opacity-30">&bull;</span>
                                    <span className="opacity-80">Current chat</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteChat(chat.id, event);
                              }}
                              className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-md text-text-lighter opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                              aria-label={`Delete ${chat.title}`}
                              title="Delete chat"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })
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

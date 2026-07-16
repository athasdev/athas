import { CheckIcon as Check, MagnifyingGlassIcon as Search, TrashIcon as Trash2 } from "@/ui/icons";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItemAction,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
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
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredChats = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return chats;

    return chats.filter((chat) => {
      const titleMatch = chat.title.toLowerCase().includes(query);
      const providerMatch = (chat.agentId ?? "custom").toLowerCase().includes(query);
      return titleMatch || providerMatch;
    });
  }, [chats, deferredSearchQuery]);

  const handleClose = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
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
  }, [filteredChats, handleClose, isOpen, onSwitchToChat, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredSearchQuery]);

  useEffect(() => {
    if (!resultsRef.current || filteredChats.length === 0) return;
    const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [filteredChats.length, selectedIndex]);

  return (
    <Command isVisible={isOpen} onClose={handleClose}>
      <CommandHeader onClose={handleClose}>
        <Search className="shrink-0 text-text-lighter" size={14} />
        <CommandInput
          ref={inputRef}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search agent history..."
        />
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {chats.length === 0 ? (
          <CommandEmpty>No agent history yet</CommandEmpty>
        ) : filteredChats.length === 0 ? (
          <CommandEmpty>No sessions match "{searchQuery}"</CommandEmpty>
        ) : (
          filteredChats.map((chat, index) => {
            const isCurrent = chat.id === currentChatId;
            const isSelected = index === selectedIndex;
            const providerLabel = (chat.agentId || "custom").replace(/-/g, " ");

            return (
              <CommandItemRow
                key={chat.id}
                as="div"
                onClick={() => {
                  onSwitchToChat(chat.id);
                  handleClose();
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                isSelected={isSelected}
                className={cn("group", isCurrent && !isSelected && "bg-accent/10 text-text")}
                aria-current={isCurrent}
                icon={
                  isCurrent ? (
                    <Check className="text-accent" size={14} />
                  ) : (
                    <ProviderIcon
                      providerId={chat.agentId || "custom"}
                      size={13}
                      className="text-text-lighter"
                    />
                  )
                }
                title={<span className={cn(isCurrent && "text-accent")}>{chat.title}</span>}
                accessory={
                  <>
                    <CommandItemBadge>{providerLabel}</CommandItemBadge>
                    <CommandItemBadge>{getRelativeTime(chat.lastMessageAt)}</CommandItemBadge>
                  </>
                }
                action={
                  <CommandItemAction
                    type="button"
                    tone="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteChat(chat.id, event);
                    }}
                    aria-label={`Delete ${chat.title}`}
                    tooltip="Delete session"
                  >
                    <Trash2 size={13} />
                  </CommandItemAction>
                }
              />
            );
          })
        )}
      </CommandList>
    </Command>
  );
}

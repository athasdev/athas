import { History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Input from "@/ui/input";
import Tooltip from "@/ui/tooltip";
import { useAIChatStore } from "../../store/store";
import ChatHistoryDropdown from "../history/sidebar";
import { UnifiedAgentSelector } from "../selectors/unified-agent-selector";

function EditableChatTitle({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      onUpdateTitle(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="rounded-full border-border bg-secondary-bg/80 px-2.5 py-1 font-medium focus:border-accent/40 focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="block max-w-full cursor-pointer truncate rounded-full px-2 py-1 font-medium transition-colors hover:bg-hover"
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

interface ChatHeaderProps {
  onDeleteChat?: (chatId: string, event: React.MouseEvent) => void;
}

export function ChatHeader({ onDeleteChat }: ChatHeaderProps) {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const getCurrentChat = useAIChatStore((state) => state.getCurrentChat);
  const chats = useAIChatStore((state) => state.chats);
  const isChatHistoryVisible = useAIChatStore((state) => state.isChatHistoryVisible);
  const setIsChatHistoryVisible = useAIChatStore((state) => state.setIsChatHistoryVisible);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const switchToChat = useAIChatStore((state) => state.switchToChat);

  const { openSettingsDialog } = useUIState();
  const currentChat = getCurrentChat();
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative z-[10020] flex items-center gap-2 bg-gradient-to-b from-primary-bg/80 to-transparent px-3 py-2 backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        {currentChatId ? (
          <EditableChatTitle
            title={currentChat ? currentChat.title : "New Chat"}
            onUpdateTitle={(title) => updateChatTitle(currentChatId, title)}
          />
        ) : (
          <span className="font-medium text-text text-xs">New Chat</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip content="Chat History" side="bottom">
          <button
            ref={historyButtonRef}
            onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
            className="flex size-8 items-center justify-center rounded-full border border-border bg-primary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            aria-label="Toggle chat history"
          >
            <History size={14} />
          </button>
        </Tooltip>

        <UnifiedAgentSelector variant="header" onOpenSettings={() => openSettingsDialog("ai")} />
      </div>

      <ChatHistoryDropdown
        isOpen={isChatHistoryVisible}
        onClose={() => setIsChatHistoryVisible(false)}
        chats={chats}
        currentChatId={currentChatId}
        onSwitchToChat={switchToChat}
        onDeleteChat={onDeleteChat ?? (() => {})}
        triggerRef={historyButtonRef}
      />
    </div>
  );
}

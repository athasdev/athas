import { History, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Tooltip from "@/ui/tooltip";
import { useAIChatStore } from "../../store/store";

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
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 font-medium text-text outline-none focus:border-accent/40 focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="cursor-pointer rounded-full px-2 py-1 font-medium transition-colors hover:bg-hover"
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

export function ChatHeader() {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const getCurrentChat = useAIChatStore((state) => state.getCurrentChat);
  const isChatHistoryVisible = useAIChatStore((state) => state.isChatHistoryVisible);
  const setIsChatHistoryVisible = useAIChatStore((state) => state.setIsChatHistoryVisible);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);

  const currentChat = getCurrentChat();

  const handleNewChat = () => {
    createNewChat();
  };

  return (
    <div className="relative z-[10020] flex items-center gap-2 border-border border-b bg-secondary-bg/70 px-3 py-2 backdrop-blur-sm">
      {currentChatId ? (
        <EditableChatTitle
          title={currentChat ? currentChat.title : "New Chat"}
          onUpdateTitle={(title) => updateChatTitle(currentChatId, title)}
        />
      ) : (
        <span className="font-medium text-text text-xs">New Chat</span>
      )}

      <div className="flex-1" />

      <Tooltip content="Chat History" side="bottom">
        <button
          onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
          className="flex size-8 items-center justify-center rounded-full border border-border bg-primary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          aria-label="Toggle chat history"
        >
          <History size={14} />
        </button>
      </Tooltip>

      <Tooltip content="New Chat" side="bottom">
        <button
          onClick={handleNewChat}
          className="flex size-8 items-center justify-center rounded-full border border-border bg-primary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          aria-label="New chat"
        >
          <Plus size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

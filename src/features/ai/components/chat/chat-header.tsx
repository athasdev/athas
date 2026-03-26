import { History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import {
  PANE_CHIP_BASE,
  paneHeaderClassName,
  paneIconButtonClassName,
  paneTitleClassName,
} from "@/ui/pane";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
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
        className="h-6 rounded-lg border-border/80 bg-primary-bg px-2.5 py-1 text-xs font-medium focus:border-accent/40 focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="block max-w-full cursor-pointer truncate rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-hover"
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
  const currentAgentId = useAIChatStore((state) => state.getCurrentAgentId());
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={cn("relative z-[10020]", paneHeaderClassName())}>
      <div className="min-w-0 flex-1">
        {currentChatId ? (
          <EditableChatTitle
            title={currentChat ? currentChat.title : "New Chat"}
            onUpdateTitle={(title) => updateChatTitle(currentChatId, title)}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(PANE_CHIP_BASE, "size-6 justify-center px-0")}>
              <ProviderIcon providerId={currentAgentId} size={12} />
            </span>
            <span className={cn(paneTitleClassName(), "truncate")}>New Chat</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip content="Chat History" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            ref={historyButtonRef}
            onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
            className={paneIconButtonClassName()}
            aria-label="Toggle chat history"
          >
            <History />
          </Button>
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

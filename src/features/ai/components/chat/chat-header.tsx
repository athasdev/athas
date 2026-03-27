import { Bot, GitBranch, History, Layers3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import {
  getChatCompactionPolicyShortLabel,
  isAutoCompactionEnabled,
} from "@/features/ai/lib/chat-compaction-policy";
import {
  estimateChatMessagesTokens,
  getChatSummaryCounts,
  getEffectiveChatMessages,
} from "@/features/ai/lib/chat-context";
import { getChatLineagePath } from "@/features/ai/lib/chat-lineage";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { AIChatProps, Chat } from "../../types/ai-chat";
import { UnifiedAgentSelector } from "../selectors/unified-agent-selector";

const formatTokenCount = (count: number): string =>
  count >= 1000 ? `${Math.round(count / 100) / 10}k ctx` : `${count} ctx`;

const getSurfaceAgentLabel = (chat: Chat | undefined): string => {
  if (!chat) {
    return "Pi";
  }

  switch (chat.agentId) {
    case "claude-code":
      return "Claude";
    case "codex-cli":
      return "Codex";
    case "gemini-cli":
      return "Gemini";
    case "pi":
      return "Pi";
    case "custom":
      return "API";
    default:
      return chat.agentId;
  }
};

function EditableChatTitle({
  title,
  onUpdateTitle,
  variant = "default",
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
  variant?: "default" | "harness";
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
        className={cn(
          "border border-border bg-secondary-bg/80 font-medium text-text outline-none focus:border-accent/40 focus:bg-hover",
          variant === "harness"
            ? "rounded-2xl px-3 py-2 text-base"
            : "rounded-full px-2.5 py-1 text-sm",
        )}
        style={{ minWidth: variant === "harness" ? "180px" : "100px", maxWidth: "280px" }}
      />
    );
  }

  return (
    <span
      className={cn(
        "block max-w-full cursor-pointer truncate font-medium transition-colors hover:bg-hover",
        variant === "harness"
          ? "rounded-2xl px-3 py-1.5 text-lg text-text"
          : "rounded-full px-2 py-1 text-sm",
      )}
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

interface ChatHeaderProps {
  surface?: AIChatProps["surface"];
  scopeId?: AIChatProps["scopeId"];
  onForkCurrentChat?: () => void;
}

export function ChatHeader({ surface = "panel", scopeId, onForkCurrentChat }: ChatHeaderProps) {
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);
  const { settings } = useSettingsStore();
  const { openSettingsDialog } = useUIState();
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === chatState.currentChatId),
    [chatState.chats, chatState.currentChatId],
  );
  const lineageChats = useMemo(() => {
    if (!currentChat) {
      return [];
    }

    const lineagePath = getChatLineagePath(chatState.chats, currentChat.id);
    const chatsById = new Map(chatState.chats.map((chat) => [chat.id, chat]));
    return lineagePath
      .map((chatId) => chatsById.get(chatId))
      .filter((chat): chat is Chat => Boolean(chat));
  }, [chatState.chats, currentChat]);
  const summaryCounts = currentChat ? getChatSummaryCounts(currentChat) : null;
  const contextTokenCount = currentChat
    ? estimateChatMessagesTokens(getEffectiveChatMessages(currentChat))
    : null;
  const compactionPolicyLabel = getChatCompactionPolicyShortLabel(settings.aiAutoCompactionPolicy);
  const isAutoCompactionArmed = isAutoCompactionEnabled(settings.aiAutoCompactionPolicy);
  const currentAgentLabel = getSurfaceAgentLabel(currentChat);

  if (surface === "harness") {
    return (
      <div className="relative z-[10020] border-border/70 border-b bg-primary-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1480px] items-center gap-4 px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-text-lighter uppercase tracking-[0.16em]">
              <span className="rounded-full border border-border/70 bg-secondary-bg/45 px-2 py-1 text-text">
                Harness
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Bot size={11} />
                {currentAgentLabel}
              </span>
              {contextTokenCount !== null ? (
                <span className="rounded-full border border-border/70 bg-secondary-bg/30 px-2 py-1 normal-case tracking-normal">
                  {formatTokenCount(contextTokenCount)}
                </span>
              ) : null}
              <span className="rounded-full border border-border/70 bg-secondary-bg/30 px-2 py-1 normal-case tracking-normal">
                Compact {compactionPolicyLabel}
              </span>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              {chatState.currentChatId ? (
                <EditableChatTitle
                  title={currentChat ? currentChat.title : "New Session"}
                  onUpdateTitle={(title) =>
                    chatActions.updateChatTitle(chatState.currentChatId!, title)
                  }
                  variant="harness"
                />
              ) : (
                <span className="block rounded-2xl px-3 py-1.5 font-medium text-lg text-text">
                  New Session
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip content="Session History" side="bottom">
              <button
                onClick={() => chatActions.setIsChatHistoryVisible(!chatState.isChatHistoryVisible)}
                className={cn(
                  "flex h-9 items-center justify-center rounded-2xl border border-border/70 bg-secondary-bg/45 px-3 text-text-lighter transition-colors hover:bg-hover hover:text-text",
                  chatState.isChatHistoryVisible && "bg-secondary-bg/80 text-text",
                )}
                aria-label="Toggle session history"
              >
                <History size={14} />
              </button>
            </Tooltip>

            {chatState.currentChatId && onForkCurrentChat ? (
              <Tooltip content="Fork session" side="bottom">
                <button
                  onClick={() => onForkCurrentChat()}
                  className="flex h-9 items-center justify-center rounded-2xl border border-border/70 bg-secondary-bg/45 px-3 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                  aria-label="Fork session"
                >
                  <GitBranch size={14} />
                </button>
              </Tooltip>
            ) : null}

            <Tooltip content="Compact context" side="bottom">
              <button
                onClick={() => {
                  void chatActions.compactChat("manual");
                }}
                className="flex h-9 items-center justify-center rounded-2xl border border-border/70 bg-secondary-bg/45 px-3 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label="Compact session context"
              >
                <Layers3 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-[10020] border-border/70 border-b bg-secondary-bg/90 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-lighter uppercase tracking-[0.14em]">
            <span className="rounded-full border border-border/70 bg-primary-bg/85 px-2 py-1 text-text">
              {currentAgentLabel}
            </span>
            {contextTokenCount !== null ? (
              <span className="rounded-full border border-border/70 bg-primary-bg/70 px-2 py-1 normal-case tracking-normal">
                {formatTokenCount(contextTokenCount)}
              </span>
            ) : null}
            {summaryCounts?.branch ? (
              <span className="rounded-full border border-border/70 bg-primary-bg/70 px-2 py-1 normal-case tracking-normal">
                {summaryCounts.branch} branches
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full border px-2 py-1 normal-case tracking-normal",
                isAutoCompactionArmed
                  ? "border-border/70 bg-primary-bg/70 text-text"
                  : "border-border/60 bg-primary-bg/55 text-text-lighter",
              )}
            >
              Compact {compactionPolicyLabel}
            </span>
          </div>

          {chatState.currentChatId ? (
            <>
              <EditableChatTitle
                title={currentChat ? currentChat.title : "New Chat"}
                onUpdateTitle={(title) =>
                  chatActions.updateChatTitle(chatState.currentChatId!, title)
                }
              />
              {currentChat && lineageChats.length > 1 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-text-lighter">
                  {lineageChats.map((chat, index) => (
                    <button
                      key={chat.id}
                      onClick={() => chatActions.switchToChat(chat.id)}
                      className={cn(
                        "rounded-full border border-border/60 bg-primary-bg/60 px-2 py-1 transition-colors hover:bg-hover",
                        chat.id === currentChat.id && "border-border/80 bg-primary-bg text-text",
                      )}
                    >
                      {index === 0 ? "Root" : chat.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <span className="font-medium text-sm text-text">New Chat</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip content="Chat History" side="bottom">
            <button
              onClick={() => chatActions.setIsChatHistoryVisible(!chatState.isChatHistoryVisible)}
              className="flex h-8 items-center justify-center rounded-2xl border border-border/70 bg-primary-bg/70 px-2.5 text-text-lighter transition-colors hover:bg-hover hover:text-text"
              aria-label="Toggle chat history"
            >
              <History size={14} />
            </button>
          </Tooltip>

          <Tooltip content="Compact context" side="bottom">
            <button
              onClick={() => {
                void chatActions.compactChat("manual");
              }}
              className="flex h-8 items-center justify-center rounded-2xl border border-border/70 bg-primary-bg/70 px-2.5 text-text-lighter transition-colors hover:bg-hover hover:text-text"
              aria-label="Compact chat context"
            >
              <Layers3 size={14} />
            </button>
          </Tooltip>

          <UnifiedAgentSelector
            scopeId={scopeId}
            surface={surface}
            variant="header"
            onOpenSettings={() => openSettingsDialog("ai")}
          />
        </div>
      </div>
    </div>
  );
}

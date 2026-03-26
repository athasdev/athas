import { History, Layers3 } from "lucide-react";
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
import { AGENT_OPTIONS, type AIChatProps, type Chat } from "../../types/ai-chat";
import { UnifiedAgentSelector } from "../selectors/unified-agent-selector";

const formatTokenCount = (count: number): string =>
  count >= 1000 ? `${Math.round(count / 100) / 10}k ctx` : `${count} ctx`;

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
          variant === "harness" ? "rounded-xl px-3 py-1.5 text-sm" : "rounded-full px-2.5 py-1",
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
          ? "rounded-xl px-3 py-1.5 text-base text-text"
          : "rounded-full px-2 py-1",
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
}

export function ChatHeader({ surface = "panel", scopeId }: ChatHeaderProps) {
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);
  const { settings } = useSettingsStore();
  const { openSettingsDialog } = useUIState();
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === chatState.currentChatId),
    [chatState.chats, chatState.currentChatId],
  );
  const currentAgentId = currentChat?.agentId ?? chatState.selectedAgentId;
  const currentAgentLabel =
    AGENT_OPTIONS.find((agent) => agent.id === currentAgentId)?.name ?? "Custom API";
  const currentModeLabel =
    currentAgentId === "custom"
      ? chatState.mode === "plan"
        ? "Plan"
        : "Chat"
      : chatState.sessionModeState.availableModes.find(
          (entry) => entry.id === chatState.sessionModeState.currentModeId,
        )?.name || "Session";
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

  if (surface === "harness") {
    return (
      <div className="relative z-[10020] border-border border-b bg-secondary-bg/40 px-3 py-2.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {chatState.currentChatId ? (
              <>
                <EditableChatTitle
                  title={currentChat ? currentChat.title : "New Session"}
                  onUpdateTitle={(title) =>
                    chatActions.updateChatTitle(chatState.currentChatId!, title)
                  }
                  variant="harness"
                />
                {currentChat ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-lighter">
                    <span>Harness</span>
                    <span className="text-text-lighter/60">·</span>
                    <span>{currentAgentLabel}</span>
                    <span className="text-text-lighter/60">·</span>
                    <span>{currentModeLabel}</span>
                    {contextTokenCount !== null ? (
                      <>
                        <span className="text-text-lighter/60">·</span>
                        <span>{formatTokenCount(contextTokenCount)}</span>
                      </>
                    ) : null}
                    {lineageChats.map((chat, index) => (
                      <button
                        key={chat.id}
                        onClick={() => chatActions.switchToChat(chat.id)}
                        className={cn(
                          "rounded-md border border-border/70 px-2 py-0.5 hover:bg-hover",
                          chat.id === currentChat.id && "bg-secondary-bg/70 text-text",
                        )}
                      >
                        {index === 0 ? "Root" : chat.title}
                      </button>
                    ))}
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5",
                        isAutoCompactionArmed
                          ? "border-border/80"
                          : "border-border/50 text-text-lighter",
                      )}
                    >
                      Compact {compactionPolicyLabel}
                    </span>
                    {summaryCounts ? (
                      <>
                        {summaryCounts.compaction > 0 ? (
                          <span className="rounded-md border border-border/80 px-2 py-0.5">
                            C{summaryCounts.compaction}
                          </span>
                        ) : null}
                        {summaryCounts.branch > 0 ? (
                          <span className="rounded-md border border-border/80 px-2 py-0.5">
                            B{summaryCounts.branch}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="block px-2 py-1 font-medium text-base text-text">New Session</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip content="Session History" side="bottom">
              <button
                onClick={() => chatActions.setIsChatHistoryVisible(!chatState.isChatHistoryVisible)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg border border-border bg-secondary-bg/70 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
                  chatState.isChatHistoryVisible && "bg-secondary-bg text-text",
                )}
                aria-label="Toggle session history"
              >
                <History size={14} />
              </button>
            </Tooltip>

            <Tooltip content="Compact context" side="bottom">
              <button
                onClick={() => {
                  void chatActions.compactChat("manual");
                }}
                className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary-bg/70 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
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
    <div className="relative z-[10020] flex items-center gap-2 border-border border-b bg-secondary-bg/70 px-3 py-2 backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        {chatState.currentChatId ? (
          <>
            <EditableChatTitle
              title={currentChat ? currentChat.title : "New Chat"}
              onUpdateTitle={(title) =>
                chatActions.updateChatTitle(chatState.currentChatId!, title)
              }
            />
            {currentChat ? (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-text-lighter">
                {lineageChats.map((chat, index) => (
                  <button
                    key={chat.id}
                    onClick={() => chatActions.switchToChat(chat.id)}
                    className={cn(
                      "rounded-full border border-border bg-primary-bg/80 px-2 py-1 hover:bg-hover",
                      chat.id === currentChat.id &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-300",
                    )}
                  >
                    {index === 0 ? "Root" : chat.title}
                  </button>
                ))}
                {summaryCounts ? (
                  <>
                    {contextTokenCount !== null ? (
                      <span className="rounded-full border border-border bg-primary-bg/80 px-2 py-1">
                        {formatTokenCount(contextTokenCount)}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-1",
                        isAutoCompactionArmed
                          ? "border-border bg-primary-bg/80"
                          : "border-border/60 bg-primary-bg/60 text-text-lighter",
                      )}
                    >
                      Compact {compactionPolicyLabel}
                    </span>
                    {summaryCounts.compaction > 0 ? (
                      <span className="rounded-full border border-border bg-primary-bg/80 px-2 py-1">
                        C{summaryCounts.compaction}
                      </span>
                    ) : null}
                    {summaryCounts.branch > 0 ? (
                      <span className="rounded-full border border-border bg-primary-bg/80 px-2 py-1">
                        B{summaryCounts.branch}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <span className="font-medium text-text text-xs">New Chat</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip content="Chat History" side="bottom">
          <button
            onClick={() => chatActions.setIsChatHistoryVisible(!chatState.isChatHistoryVisible)}
            className="flex size-8 items-center justify-center rounded-full border border-border bg-primary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
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
            className="flex size-8 items-center justify-center rounded-full border border-border bg-primary-bg/80 p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
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
  );
}

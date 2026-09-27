import { memo, useCallback, useEffect, useMemo } from "react";
import { buildChatTimeline } from "@/features/ai/lib/chat-timeline";
import { getFollowUpActionsForMessage } from "@/features/ai/lib/follow-up-actions";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { Message } from "@/features/ai/types/ai-chat.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import {
  MessageScrollerContent,
  MessageScrollerItem,
  useMessageScroller,
} from "@/ui/message-scroller";
import { cn } from "@/utils/cn";
import { chatContentWidth } from "./chat-content-width";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { AcpInlineEvent } from "./acp-inline-event";
import { AgentShortcuts } from "./agent-shortcuts";
import { ChatFollowUpActions } from "./chat-follow-up-actions";
import { ChatMessage } from "./chat-message";
import { ChatTerminalCommand } from "./chat-terminal-command";
import { isChatTerminalCommand } from "../../services/chat-terminal-command";

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  onSendFollowUp?: (message: string) => void | Promise<void>;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  canEditUserMessages?: boolean;
  acpEvents?: ChatAcpEvent[];
  chatId?: string | null;
  searchQuery?: string;
  activeSearchMessageId?: string | null;
  activeSearchIndex?: number;
  surfaceId: string;
  userName: string;
  userAvatarUrl?: string | null;
  assistantIconId: string;
  assistantLabel: string;
}

const EMPTY_MESSAGES: Message[] = [];

function isToolOnlyMessage(message: Message | null) {
  return Boolean(
    message?.role === "assistant" && message.toolCalls?.length && !message.content?.trim(),
  );
}

interface ChatTimelineMessageProps {
  message: Message;
  previousMessage: Message | null;
  isLastMessage: boolean;
  searchQuery: string;
  isActiveSearchMatch: boolean;
  chatId: string | null;
  canEditUserMessages: boolean;
  onApplyCode?: (code: string, language?: string) => void;
  onSendFollowUp?: (message: string) => void | Promise<void>;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  onRetryBefore: (messageId: string) => void | Promise<void>;
  userName: string;
  userAvatarUrl?: string | null;
  assistantIconId: string;
  assistantLabel: string;
}

/**
 * One message row. Memoised on its own message (and the one before it, which sets its spacing),
 * so a streamed token re-renders only the message it lands in.
 */
const ChatTimelineMessage = memo(function ChatTimelineMessage({
  message,
  previousMessage,
  isLastMessage,
  searchQuery,
  isActiveSearchMatch,
  chatId,
  canEditUserMessages,
  onApplyCode,
  onSendFollowUp,
  onEditUserMessage,
  onRetryBefore,
  userName,
  userAvatarUrl,
  assistantIconId,
  assistantLabel,
}: ChatTimelineMessageProps) {
  const canRetry = isLastMessage && canEditUserMessages && Boolean(onEditUserMessage);
  const retry = useCallback(() => onRetryBefore(message.id), [onRetryBefore, message.id]);

  if (isChatTerminalCommand(message)) {
    return (
      <MessageScrollerItem messageId={message.id} scrollAnchor data-ai-message-id={message.id}>
        <ChatTerminalCommand message={message} />
      </MessageScrollerItem>
    );
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isToolOnly = isToolOnlyMessage(message);
  const isPlanMessage = message.role === "assistant" && hasPlanBlock(message.content);
  const hasMessageFooter =
    message.role === "user" || (message.role === "assistant" && message.content.trim().length > 0);
  const matchesSearch =
    normalizedSearchQuery.length > 0 &&
    message.content.toLowerCase().includes(normalizedSearchQuery);

  return (
    <MessageScrollerItem
      messageId={message.id}
      rendering={
        normalizedSearchQuery || message.isStreaming || isLastMessage ? "eager" : "deferred"
      }
      scrollAnchor={message.role === "user"}
      data-ai-message-id={message.id}
      className={cn(
        isToolOnly
          ? isToolOnlyMessage(previousMessage)
            ? "py-1"
            : "pt-2 pb-1"
          : hasMessageFooter
            ? "pt-2 pb-6"
            : "py-2",
        isPlanMessage && "pt-2",
        matchesSearch && "transition-colors",
        matchesSearch &&
          (isActiveSearchMatch
            ? "bg-primary-soft ring-1 ring-inset ring-focus"
            : "bg-primary-soft"),
      )}
    >
      <ChatMessage
        message={message}
        isLastMessage={isLastMessage}
        onApplyCode={onApplyCode}
        onRetry={canRetry ? retry : undefined}
        onEditUserMessage={onEditUserMessage}
        canEditUserMessage={canEditUserMessages}
        searchQuery={searchQuery}
        chatId={chatId}
        onExecutePlanStep={onSendFollowUp}
        userName={userName}
        userAvatarUrl={userAvatarUrl}
        assistantIconId={assistantIconId}
        assistantLabel={assistantLabel}
      />
      {isLastMessage && message.role === "assistant" && onSendFollowUp ? (
        <ChatFollowUpActions
          actions={getFollowUpActionsForMessage(message)}
          onSelect={(prompt) => void onSendFollowUp(prompt)}
        />
      ) : null}
    </MessageScrollerItem>
  );
});

export const ChatMessages = memo(function ChatMessages({
  onApplyCode,
  onSendFollowUp,
  onEditUserMessage,
  canEditUserMessages = false,
  acpEvents,
  chatId,
  searchQuery = "",
  activeSearchMessageId,
  activeSearchIndex,
  surfaceId,
  userName,
  userAvatarUrl,
  assistantIconId,
  assistantLabel,
}: ChatMessagesProps) {
  const { scrollToMessage } = useMessageScroller();
  const resolvedChatId = useAIChatStore((state) => chatId ?? state.currentChatId);
  // The message list keeps its identity while other chats change, so this only re-renders for
  // this chat's own updates.
  const messages = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === resolvedChatId)?.messages ?? EMPTY_MESSAGES,
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const timelineItems = useMemo(
    () => buildChatTimeline(messages, acpEvents),
    [messages, acpEvents],
  );
  const retryBefore = useCallback(
    (messageId: string) => {
      if (!resolvedChatId || !onEditUserMessage) return;
      const current = useAIChatStore.getState().actions.getMessagesForChat(resolvedChatId);
      const index = current.findIndex((message) => message.id === messageId);
      const prompt = current
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((message) => message.role === "user");
      if (prompt) return onEditUserMessage(prompt.id, prompt.content);
    },
    [resolvedChatId, onEditUserMessage],
  );

  useEffect(() => {
    if (!activeSearchMessageId) return;
    scrollToMessage(activeSearchMessageId, {
      align: "center",
      behavior: "smooth",
    });
  }, [activeSearchMessageId, activeSearchIndex, scrollToMessage]);

  if (messages.length === 0) {
    return (
      <MessageScrollerContent className={cn(chatContentWidth(), "justify-end py-4")}>
        <AgentShortcuts className="mx-auto max-w-sm" surfaceId={surfaceId} />
      </MessageScrollerContent>
    );
  }

  return (
    <MessageScrollerContent
      className={cn(chatContentWidth(), "py-4")}
      aria-busy={messages.some((message) => message.isStreaming)}
    >
      {timelineItems.map((item) => {
        if (item.type === "acp") {
          return (
            <MessageScrollerItem
              key={item.id}
              messageId={item.id}
              rendering={
                normalizedSearchQuery ||
                item.event.category === "permission" ||
                item.event.state === "running"
                  ? "eager"
                  : "deferred"
              }
            >
              <AcpInlineEvent event={item.event} />
            </MessageScrollerItem>
          );
        }

        const index = item.messageIndex;
        return (
          <ChatTimelineMessage
            key={item.id}
            message={item.message}
            previousMessage={index > 0 ? (messages[index - 1] ?? null) : null}
            isLastMessage={index === messages.length - 1}
            searchQuery={searchQuery}
            isActiveSearchMatch={item.message.id === activeSearchMessageId}
            chatId={resolvedChatId}
            canEditUserMessages={canEditUserMessages}
            onApplyCode={onApplyCode}
            onSendFollowUp={onSendFollowUp}
            onEditUserMessage={onEditUserMessage}
            onRetryBefore={retryBefore}
            userName={userName}
            userAvatarUrl={userAvatarUrl}
            assistantIconId={assistantIconId}
            assistantLabel={assistantLabel}
          />
        );
      })}
    </MessageScrollerContent>
  );
});

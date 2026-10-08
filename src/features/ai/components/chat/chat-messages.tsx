import { memo, useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { buildChatTimeline, toMs } from "@/features/ai/lib/chat-timeline";
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
import { useChatMessageIds } from "../../hooks/use-chat-store";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { AcpInlineEvent } from "./acp-inline-event";
import { AgentShortcuts } from "./agent-shortcuts";
import { ChatFollowUpActions } from "./chat-follow-up-actions";
import { ChatMessage } from "./chat-message";
import { ChatTerminalCommand } from "./chat-terminal-command";
import { isChatTerminalCommand } from "../../services/chat-terminal-command";

interface ChatMessagesProps {
  onSendFollowUp?: (message: string) => void | Promise<void>;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  canEditUserMessages?: boolean;
  /** Starts the latest turn over while the agent has not answered for a while. */
  onRetryStalledResponse?: () => void;
  acpEvents?: ChatAcpEvent[];
  chatId?: string | null;
  searchQuery?: string;
  activeSearchMessageId?: string | null;
  activeSearchIndex?: number;
  surfaceId: string;
}

const EMPTY_TIMESTAMPS: number[] = [];

function isToolOnlyMessage(message: Message | null | undefined) {
  return Boolean(
    message?.role === "assistant" && message.toolCalls?.length && !message.content?.trim(),
  );
}

/** The message at `index` when it is still there, else wherever it moved. */
function findMessage(messages: Message[] | undefined, index: number, messageId: string) {
  const atIndex = messages?.[index];
  return atIndex?.id === messageId
    ? atIndex
    : messages?.find((candidate) => candidate.id === messageId);
}

interface ChatTimelineMessageProps {
  chatId: string;
  messageId: string;
  messageIndex: number;
  isLastMessage: boolean;
  searchQuery: string;
  isActiveSearchMatch: boolean;
  canEditUserMessages: boolean;
  onSendFollowUp?: (message: string) => void | Promise<void>;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  onRetryBefore: (messageId: string) => void | Promise<void>;
  onRetryStalled?: () => void;
}

/**
 * One message row. It reads its own message from the store (and whether the one before it is
 * tool-only, which sets its spacing), so a streamed token re-renders only the row it lands in.
 */
const ChatTimelineMessage = memo(function ChatTimelineMessage({
  chatId,
  messageId,
  messageIndex,
  isLastMessage,
  searchQuery,
  isActiveSearchMatch,
  canEditUserMessages,
  onSendFollowUp,
  onEditUserMessage,
  onRetryBefore,
  onRetryStalled,
}: ChatTimelineMessageProps) {
  const message = useAIChatStore((state) =>
    findMessage(state.messagesByChat[chatId], messageIndex, messageId),
  );
  const followsToolOnlyMessage = useAIChatStore((state) =>
    isToolOnlyMessage(state.messagesByChat[chatId]?.[messageIndex - 1]),
  );
  const canRetry = isLastMessage && canEditUserMessages && Boolean(onEditUserMessage);
  const retry = useCallback(() => onRetryBefore(messageId), [onRetryBefore, messageId]);

  if (!message) return null;

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
        // A prompt opens a turn with room above it; the agent's reply sits close beneath it,
        // and tool-only messages of one turn run together. Message footers sit inside the
        // message's own box, so a deferred item's content-visibility never clips them.
        message.role === "user"
          ? messageIndex > 0
            ? "mt-3"
            : undefined
          : isToolOnly
            ? followsToolOnlyMessage
              ? "my-0.5"
              : "my-1"
            : "my-1",
        isPlanMessage && "mt-2",
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
        onRetry={canRetry ? retry : undefined}
        onRetryStalled={onRetryStalled}
        onEditUserMessage={onEditUserMessage}
        canEditUserMessage={canEditUserMessages}
        searchQuery={searchQuery}
        chatId={chatId}
        onExecutePlanStep={onSendFollowUp}
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
  onSendFollowUp,
  onEditUserMessage,
  canEditUserMessages = false,
  onRetryStalledResponse,
  acpEvents,
  chatId,
  searchQuery = "",
  activeSearchMessageId,
  activeSearchIndex,
  surfaceId,
}: ChatMessagesProps) {
  const { scrollToMessage } = useMessageScroller();
  const resolvedChatId = useAIChatStore((state) => chatId ?? state.currentChatId);
  // The list itself only follows which messages there are and when they were sent: a streamed
  // token changes neither, so it re-renders the streaming row alone, not the list.
  const messageIds = useChatMessageIds(resolvedChatId);
  const messageTimestamps = useAIChatStore(
    useShallow(
      (state) =>
        (resolvedChatId ? state.messagesByChat[resolvedChatId] : undefined)?.map((message) =>
          toMs(message.timestamp),
        ) ?? EMPTY_TIMESTAMPS,
    ),
  );
  const isStreaming = useAIChatStore((state) =>
    Boolean(
      resolvedChatId &&
      state.messagesByChat[resolvedChatId]?.some((message) => message.isStreaming),
    ),
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const timelineItems = useMemo(
    () =>
      buildChatTimeline(
        messageIds.map((id, index) => ({ id, timestamp: messageTimestamps[index] ?? 0 })),
        acpEvents,
      ),
    [messageIds, messageTimestamps, acpEvents],
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

  if (!resolvedChatId || messageIds.length === 0) {
    return (
      <MessageScrollerContent className={cn(chatContentWidth(), "justify-end py-4")}>
        <AgentShortcuts className="mx-auto max-w-sm" surfaceId={surfaceId} />
      </MessageScrollerContent>
    );
  }

  return (
    <MessageScrollerContent className={cn(chatContentWidth(), "py-4")} aria-busy={isStreaming}>
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
        const isLastMessage = index === messageIds.length - 1;
        return (
          <ChatTimelineMessage
            key={item.id}
            chatId={resolvedChatId}
            messageId={item.message.id}
            messageIndex={index}
            isLastMessage={isLastMessage}
            searchQuery={searchQuery}
            isActiveSearchMatch={item.message.id === activeSearchMessageId}
            canEditUserMessages={canEditUserMessages}
            onSendFollowUp={onSendFollowUp}
            onEditUserMessage={onEditUserMessage}
            onRetryBefore={retryBefore}
            onRetryStalled={isLastMessage ? onRetryStalledResponse : undefined}
          />
        );
      })}
    </MessageScrollerContent>
  );
});

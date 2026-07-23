import { memo, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getFollowUpActionsForMessage } from "@/features/ai/lib/follow-up-actions";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import {
  MessageScrollerContent,
  MessageScrollerItem,
  useMessageScroller,
} from "@/ui/message-scroller";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { AcpInlineEvent } from "./acp-inline-event";
import { AgentShortcuts } from "./agent-shortcuts";
import { ChatFollowUpActions } from "./chat-follow-up-actions";
import { ChatMessage } from "./chat-message";

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
}

const getTimestampMs = (value: Date | string): number => {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

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
}: ChatMessagesProps) {
  const { scrollToMessage } = useMessageScroller();
  const { currentChatId, chats } = useAIChatStore(
    useShallow((state) => ({
      currentChatId: state.currentChatId,
      chats: state.chats,
    })),
  );
  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === (chatId ?? currentChatId)),
    [chatId, chats, currentChatId],
  );
  const messages = currentChat?.messages || [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const timelineItems = useMemo(
    () =>
      [
        ...messages.map((message, messageIndex) => ({
          id: `message-${message.id}`,
          type: "message" as const,
          timestamp: getTimestampMs(message.timestamp),
          order: messageIndex,
          message,
          messageIndex,
        })),
        ...(acpEvents || []).map((event, eventIndex) => ({
          id: `acp-${event.id}`,
          type: "acp" as const,
          timestamp: getTimestampMs(event.timestamp),
          order: messages.length + eventIndex,
          event,
        })),
      ].sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }

        return a.order - b.order;
      }),
    [messages, acpEvents],
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
      <MessageScrollerContent className="justify-end px-4 pb-2 pt-4">
        <AgentShortcuts className="mx-auto max-w-sm" surfaceId={surfaceId} />
      </MessageScrollerContent>
    );
  }

  return (
    <MessageScrollerContent aria-busy={messages.some((message) => message.isStreaming)}>
      {timelineItems.map((item) => {
        if (item.type === "acp") {
          if (item.event.kind === "thinking") return null;

          return (
            <MessageScrollerItem key={item.id} messageId={item.id}>
              <AcpInlineEvent event={item.event} />
            </MessageScrollerItem>
          );
        }

        const message = item.message;
        const index = item.messageIndex;
        const isLastMessage = index === messages.length - 1;
        const prevMessage = index > 0 ? messages[index - 1] : null;
        const isToolOnlyMessage =
          message.role === "assistant" &&
          message.toolCalls &&
          message.toolCalls.length > 0 &&
          (!message.content || message.content.trim().length === 0);
        const previousMessageIsToolOnly =
          prevMessage &&
          prevMessage.role === "assistant" &&
          prevMessage.toolCalls &&
          prevMessage.toolCalls.length > 0 &&
          (!prevMessage.content || prevMessage.content.trim().length === 0);

        const isPlanMessage = message.role === "assistant" && hasPlanBlock(message.content);
        const messageClassName = [
          isToolOnlyMessage
            ? previousMessageIsToolOnly
              ? "px-4 py-1"
              : "px-4 pt-2 pb-1"
            : "px-4 py-2",
          isPlanMessage ? "pt-2" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const matchesSearch =
          normalizedSearchQuery.length > 0 &&
          message.content.toLowerCase().includes(normalizedSearchQuery);
        const isActiveSearchMatch = matchesSearch && message.id === activeSearchMessageId;

        return (
          <MessageScrollerItem
            key={item.id}
            messageId={message.id}
            scrollAnchor={message.role === "user"}
            data-ai-message-id={message.id}
            className={cn(
              messageClassName,
              matchesSearch && "transition-colors",
              matchesSearch &&
                (isActiveSearchMatch
                  ? "bg-accent/10 ring-1 ring-inset ring-accent/30"
                  : "bg-accent/5"),
            )}
          >
            <ChatMessage
              message={message}
              isLastMessage={isLastMessage}
              onApplyCode={onApplyCode}
              onEditUserMessage={onEditUserMessage}
              canEditUserMessage={canEditUserMessages}
              searchQuery={searchQuery}
              chatId={currentChat?.id}
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
      })}
    </MessageScrollerContent>
  );
});

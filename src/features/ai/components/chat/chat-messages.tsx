import { memo, useEffect, useMemo } from "react";
import { getFollowUpActionsForMessage } from "@/features/ai/lib/follow-up-actions";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
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
  userName,
  userAvatarUrl,
  assistantIconId,
  assistantLabel,
}: ChatMessagesProps) {
  const { scrollToMessage } = useMessageScroller();
  const currentChat = useAIChatStore((state) =>
    state.chats.find((chat) => chat.id === (chatId ?? state.currentChatId)),
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
        const hasMessageFooter =
          message.role === "user" ||
          (message.role === "assistant" && message.content.trim().length > 0);
        const messageClassName = [
          isToolOnlyMessage
            ? previousMessageIsToolOnly
              ? "py-1"
              : "pt-2 pb-1"
            : hasMessageFooter
              ? "pt-2 pb-6"
              : "py-2",
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
                  ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                  : "bg-primary/5"),
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
      })}
    </MessageScrollerContent>
  );
});

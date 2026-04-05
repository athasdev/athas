import { forwardRef, memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { Button } from "@/ui/button";
import { getRelativeTime } from "../../lib/formatting";
import { useAIChatStore } from "../../store/store";
import { AcpInlineEvent } from "./acp-inline-event";
import { ChatMessage } from "./chat-message";

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  acpEvents?: ChatAcpEvent[];
}

const getTimestampMs = (value: Date | string): number => {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const ChatMessages = memo(
  forwardRef<HTMLDivElement, ChatMessagesProps>(function ChatMessages(
    { onApplyCode, acpEvents },
    ref,
  ) {
    const { currentChatId, chats, switchToChat } = useAIChatStore(
      useShallow((state) => ({
        currentChatId: state.currentChatId,
        chats: state.chats,
        switchToChat: state.switchToChat,
      })),
    );

    const currentChat = useMemo(
      () => chats.find((chat) => chat.id === currentChatId),
      [chats, currentChatId],
    );
    const messages = currentChat?.messages || [];
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

    // Get recent chats excluding the current one (title "New Chat" means it's empty/unused)
    const recentChats = useMemo(
      () =>
        chats
          .filter((chat) => chat.id !== currentChatId && chat.title !== "New Chat")
          .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
          .slice(0, 5),
      [chats, currentChatId],
    );

    if (messages.length === 0) {
      if (recentChats.length === 0) {
        return null;
      }

      return (
        <div className="flex h-full flex-col items-center justify-center p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border/40 bg-secondary-bg/30 p-1">
            {recentChats.map((chat) => (
              <Button
                key={chat.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => switchToChat(chat.id)}
                className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left"
              >
                <ProviderIcon
                  providerId={chat.agentId || "custom"}
                  size={12}
                  className="shrink-0 text-text-lighter"
                />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                  <span className="block w-full truncate text-left text-text text-xs">
                    {chat.title}
                  </span>
                  <span className="block w-full select-none text-left text-[10px] text-text-lighter">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                </div>
              </Button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <>
        {timelineItems.map((item) => {
          if (item.type === "acp") {
            return <AcpInlineEvent key={item.id} event={item.event} />;
          }

          const message = item.message;
          const index = item.messageIndex;
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

          return (
            <div key={item.id} className={messageClassName}>
              <ChatMessage
                message={message}
                isLastMessage={index === messages.length - 1}
                onApplyCode={onApplyCode}
              />
            </div>
          );
        })}
        <div ref={ref} />
      </>
    );
  }),
);

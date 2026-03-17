import { AlertCircle, CheckCircle, Clock } from "lucide-react";
import { forwardRef, memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";
import { getRelativeTime } from "../../lib/formatting";
import { useAIChatStore } from "../../store/store";
import { ChatMessage } from "./chat-message";

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  acpEvents?: ChatAcpEvent[];
}

const getEventStatusIcon = (
  state: ChatAcpEvent["state"],
): { Icon: typeof Clock; className: string; spin?: boolean } => {
  switch (state) {
    case "running":
      return { Icon: Clock, className: "text-text-lighter/55", spin: true };
    case "success":
      return { Icon: CheckCircle, className: "text-text-lighter/65" };
    case "error":
      return { Icon: AlertCircle, className: "text-red-400/70" };
    default:
      return { Icon: CheckCircle, className: "text-text-lighter/65" };
  }
};

const getVisibleEventDetail = (event: ChatAcpEvent): string | null => {
  if (!event.detail) return null;
  const normalized = event.detail.trim().toLowerCase();
  if (normalized === "running" || normalized === "completed" || normalized === "failed") {
    return null;
  }
  return event.detail;
};

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
    const timelineItems = useMemo(() => {
      const messageItems = messages.map((message, messageIndex) => ({
        type: "message" as const,
        id: `message-${message.id}`,
        timestamp: getTimestampMs(message.timestamp),
        order: messageIndex,
        message,
        messageIndex,
      }));
      const eventItems = (acpEvents || []).map((event, eventIndex) => ({
        type: "event" as const,
        id: `event-${event.id}`,
        timestamp: getTimestampMs(event.timestamp),
        order: messages.length + eventIndex,
        event,
      }));

      return [...messageItems, ...eventItems].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.order - b.order;
      });
    }, [messages, acpEvents]);

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
          <div className="w-full max-w-sm space-y-0.5">
            {recentChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => switchToChat(chat.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <ProviderIcon
                  providerId={chat.agentId || "custom"}
                  size={12}
                  className="shrink-0 text-text-lighter"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-text text-xs">{chat.title}</span>
                  <span className="select-none text-[10px] text-text-lighter">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <>
        {timelineItems.map((item) => {
          if (item.type === "message") {
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
            const messageClassName = cn(
              isToolOnlyMessage
                ? previousMessageIsToolOnly
                  ? "px-4 py-1"
                  : "px-4 pt-2 pb-1"
                : "px-4 py-2",
              isPlanMessage && "pt-2",
            );

            return (
              <div key={item.id} className={messageClassName}>
                <ChatMessage
                  message={message}
                  isLastMessage={index === messages.length - 1}
                  onApplyCode={onApplyCode}
                />
              </div>
            );
          }

          const event = item.event;
          const statusIcon = getEventStatusIcon(event.state);
          const StatusIcon = statusIcon.Icon;
          const detail = getVisibleEventDetail(event);

          return (
            <div key={item.id} className="px-4 py-1">
              <div className="flex items-center gap-1 text-xs leading-tight">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-text-lighter/80">{event.label}</span>
                  {detail ? (
                    <>
                      <span className="opacity-40"> · </span>
                      <span className="text-text-lighter/60">{detail}</span>
                    </>
                  ) : null}
                </span>
                <StatusIcon
                  size={10}
                  className={cn(
                    "shrink-0",
                    statusIcon.className,
                    statusIcon.spin && "animate-spin",
                  )}
                />
              </div>
            </div>
          );
        })}
        <div ref={ref} />
      </>
    );
  }),
);

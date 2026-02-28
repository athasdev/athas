import {
  Activity,
  AlertCircle,
  Brain,
  Map as MapIcon,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { forwardRef, memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";
import { getRelativeTime } from "../../lib/formatting";
import { useAIChatStore } from "../../store/store";
import { AGENT_OPTIONS } from "../../types/ai-chat";
import { ChatMessage } from "./chat-message";

// Get short agent label for badge
const getAgentLabel = (agentId: string | undefined): string => {
  if (!agentId) return "API";
  const agent = AGENT_OPTIONS.find((a) => a.id === agentId);
  if (!agent) return "API";
  switch (agentId) {
    case "claude-code":
      return "Claude";
    case "gemini-cli":
      return "Gemini";
    case "codex-cli":
      return "Codex";
    case "custom":
      return "API";
    default:
      return agent.name.split(" ")[0];
  }
};

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  acpEvents?: ChatAcpEvent[];
}

const getEventIcon = (kind: ChatAcpEvent["kind"]) => {
  switch (kind) {
    case "thinking":
      return Brain;
    case "tool":
      return Wrench;
    case "plan":
      return MapIcon;
    case "mode":
      return Settings2;
    case "error":
      return AlertCircle;
    case "permission":
      return ShieldCheck;
    case "status":
      return Activity;
    default:
      return Activity;
  }
};

const getStateClasses = (state: ChatAcpEvent["state"]) => {
  switch (state) {
    case "running":
      return "border-border/80 bg-secondary-bg/80 text-text";
    case "success":
      return "border-border/80 bg-secondary-bg/80 text-text-lighter";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    default:
      return "border-border/80 bg-secondary-bg/80 text-text-lighter";
  }
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
          <div className="w-full max-w-sm rounded-2xl border border-border bg-primary-bg/90 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-text-lighter text-xs">
              <MessageSquare size={12} />
              <span>Recent Chats</span>
            </div>
            <div className="space-y-1">
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => switchToChat(chat.id)}
                  className="flex w-full items-center gap-2 rounded-xl border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-text text-xs">{chat.title}</span>
                  <span className="shrink-0 text-[10px] text-text-lighter">
                    {getAgentLabel(chat.agentId)}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-lighter">
                    {getRelativeTime(chat.lastMessageAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {messages.map((message, index) => {
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
            <div key={message.id} className={messageClassName}>
              <ChatMessage
                message={message}
                isLastMessage={index === messages.length - 1}
                onApplyCode={onApplyCode}
              />
            </div>
          );
        })}
        {acpEvents && acpEvents.length > 0 && (
          <div className="px-4 pb-2">
            <div className="rounded-2xl border border-border bg-primary-bg/70 px-2.5 py-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-text-lighter text-xs">
                <Activity size={12} />
                <span>Agent Activity</span>
              </div>
              <div className="space-y-1">
                {acpEvents.slice(-8).map((event) => {
                  const Icon = getEventIcon(event.kind);
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2 py-1 text-xs",
                        getStateClasses(event.state),
                      )}
                    >
                      <Icon
                        size={11}
                        className={cn(event.state === "running" && "animate-pulse")}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {event.label}
                        {event.detail ? (
                          <span className="opacity-75"> · {event.detail}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 opacity-60">
                        {getRelativeTime(event.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div ref={ref} />
      </>
    );
  }),
);

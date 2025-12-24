import { MessageSquare } from "lucide-react";
import { forwardRef } from "react";
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
}

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(function ChatMessages(
  { onApplyCode },
  ref,
) {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const currentChat = chats.find((chat) => chat.id === currentChatId);
  const messages = currentChat?.messages || [];

  // Get recent chats excluding the current one (title "New Chat" means it's empty/unused)
  const recentChats = chats
    .filter((chat) => chat.id !== currentChatId && chat.title !== "New Chat")
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, 5);

  if (messages.length === 0) {
    if (recentChats.length === 0) {
      return null;
    }

    return (
      <div className="flex h-full flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-2 flex items-center gap-1.5 text-text-lighter text-xs">
            <MessageSquare size={12} />
            <span>Recent Chats</span>
          </div>
          <div className="space-y-0.5">
            {recentChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => switchToChat(chat.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-hover"
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

        const className = isToolOnlyMessage
          ? previousMessageIsToolOnly
            ? "px-3"
            : "px-3 pt-1"
          : "p-3";

        return (
          <div key={message.id} className={className}>
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
});

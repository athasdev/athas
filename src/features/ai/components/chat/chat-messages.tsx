import { Sparkles } from "lucide-react";
import { forwardRef } from "react";
import { useAIChatStore } from "../../store/store";
import { ChatMessage } from "./chat-message";

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
}

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(function ChatMessages(
  { onApplyCode },
  ref,
) {
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const currentChat = chats.find((chat) => chat.id === currentChatId);
  const messages = currentChat?.messages || [];

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <div>
          <Sparkles size={24} className="mx-auto mb-2 opacity-50" />
          <div className="text-sm">AI Assistant</div>
          <div className="mt-1 text-text-lighter">Ask me anything about your code</div>
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

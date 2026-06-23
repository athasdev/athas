import { forwardRef, memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { getFollowUpActionsForMessage } from "@/features/ai/lib/follow-up-actions";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import { dispatchAIChatSkillInsert } from "@/features/ai/lib/skill-events";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { ConversationContent, ConversationEmptyState } from "../elements/conversation";
import { AcpInlineEvent } from "./acp-inline-event";
import { ChatFollowUpActions } from "./chat-follow-up-actions";
import { ChatMessage } from "./chat-message";

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  onSendFollowUp?: (message: string) => void | Promise<void>;
  acpEvents?: ChatAcpEvent[];
  chatId?: string | null;
  searchQuery?: string;
  activeSearchMessageId?: string | null;
  activeSearchIndex?: number;
}

const getTimestampMs = (value: Date | string): number => {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const ChatMessages = memo(
  forwardRef<HTMLDivElement, ChatMessagesProps>(function ChatMessages(
    {
      onApplyCode,
      onSendFollowUp,
      acpEvents,
      chatId,
      searchQuery = "",
      activeSearchMessageId,
      activeSearchIndex,
    },
    ref,
  ) {
    const messageRefs = useRef(new Map<string, HTMLDivElement>());
    const { currentChatId, chats } = useAIChatStore(
      useShallow((state) => ({
        currentChatId: state.currentChatId,
        chats: state.chats,
      })),
    );
    const skills = useSettingsStore((state) => state.settings.aiSkills);

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

    const visibleSkills = useMemo(
      () =>
        [...skills].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8),
      [skills],
    );

    const handleSkillSelect = (skill: AIChatSkill) => {
      dispatchAIChatSkillInsert(skill);
    };

    const setMessageRef = useCallback(
      (messageId: string) => (node: HTMLDivElement | null) => {
        if (node) {
          messageRefs.current.set(messageId, node);
          return;
        }

        messageRefs.current.delete(messageId);
      },
      [],
    );

    useEffect(() => {
      if (!activeSearchMessageId) return;
      messageRefs.current.get(activeSearchMessageId)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, [activeSearchMessageId, activeSearchIndex]);

    if (messages.length === 0) {
      return (
        <ConversationEmptyState>
          <div className="mx-auto flex w-full max-w-sm flex-wrap justify-center gap-1.5">
            {visibleSkills.map((skill) => (
              <Button
                key={skill.id}
                type="button"
                variant="ghost"
                onClick={() => handleSkillSelect(skill)}
                className="ui-text-xs h-6 max-w-full rounded-md border border-dashed border-border/60 bg-transparent px-2 text-text-lighter/70 hover:border-border-strong hover:bg-transparent hover:text-text"
                aria-label={`Use skill ${skill.title}`}
              >
                <span className="min-w-0 truncate">{skill.title}</span>
              </Button>
            ))}
          </div>
        </ConversationEmptyState>
      );
    }

    return (
      <ConversationContent>
        {timelineItems.map((item) => {
          if (item.type === "acp") {
            return <AcpInlineEvent key={item.id} event={item.event} />;
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
            <div
              key={item.id}
              ref={setMessageRef(message.id)}
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
                searchQuery={searchQuery}
              />
              {isLastMessage && message.role === "assistant" && onSendFollowUp ? (
                <ChatFollowUpActions
                  actions={getFollowUpActionsForMessage(message)}
                  onSelect={(prompt) => void onSendFollowUp(prompt)}
                />
              ) : null}
            </div>
          );
        })}
        <div ref={ref} />
      </ConversationContent>
    );
  }),
);

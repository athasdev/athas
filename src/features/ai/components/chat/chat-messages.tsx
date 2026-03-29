import {
  AlertCircle,
  CheckCircle,
  Clock,
  ListTodo,
  MessageSquare,
  Sparkles,
  Wrench,
} from "lucide-react";
import { forwardRef, memo, useMemo } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import { getAcpPlanEntryCounts } from "@/features/ai/lib/chat-acp-activity";
import { filterChatsForScope, getDefaultChatTitle } from "@/features/ai/lib/chat-scope";
import {
  filterTranscriptAcpEvents,
  getTranscriptAcpEventGroupLabel,
} from "@/features/ai/lib/chat-transcript-events";
import { hasPlanBlock } from "@/features/ai/lib/plan-parser";
import type { ChatScopeId } from "@/features/ai/types/ai-chat";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { cn } from "@/utils/cn";
import { getRelativeTime } from "../../lib/formatting";
import { AGENT_OPTIONS } from "../../types/ai-chat";
import ToolCallDisplay from "../messages/tool-call-display";
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
    case "pi":
      return "Pi";
    case "custom":
      return "API";
    default:
      return agent.name.split(" ")[0];
  }
};

interface ChatMessagesProps {
  onApplyCode?: (code: string, language?: string) => void;
  acpEvents?: ChatAcpEvent[];
  surface?: "panel" | "harness";
  scopeId?: ChatScopeId;
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

import { Circle, CircleDot } from "lucide-react";

const getPlanStatusTone = (status: "pending" | "in_progress" | "completed") => {
  switch (status) {
    case "completed":
      return { Icon: CheckCircle, className: "text-green-500/80" };
    case "in_progress":
      return { Icon: CircleDot, className: "text-blue-400" };
    default:
      return { Icon: Circle, className: "text-text-lighter/40" };
  }
};

const getTimestampMs = (value: Date | string): number => {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isStructuredToolEvent = (event: ChatAcpEvent): boolean =>
  event.kind === "tool" &&
  Boolean(
    event.tool?.input || event.tool?.output || event.tool?.error || event.tool?.locations?.length,
  );

export const ChatMessages = memo(
  forwardRef<HTMLDivElement, ChatMessagesProps>(function ChatMessages(
    { onApplyCode, acpEvents, surface = "panel", scopeId },
    ref,
  ) {
    const chatState = useChatState(scopeId);
    const chatActions = useChatActions(scopeId);
    const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
    const chats = useMemo(
      () => filterChatsForScope(chatState.chats, scopeId ?? "panel"),
      [chatState.chats, scopeId],
    );

    const currentChat = useMemo(
      () => chats.find((chat) => chat.id === chatState.currentChatId),
      [chats, chatState.currentChatId],
    );
    const messages = currentChat?.messages || [];
    const planEntries = currentChat?.acpActivity?.planEntries ?? [];
    const planCounts = useMemo(
      () => getAcpPlanEntryCounts(currentChat?.acpActivity),
      [currentChat],
    );
    const hasPersistedAcpActivity = planEntries.length > 0 || (acpEvents?.length ?? 0) > 0;
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
    const timelineRows = useMemo(() => {
      const rows: Array<
        | {
            type: "message";
            id: string;
            message: (typeof messages)[number];
            messageIndex: number;
          }
        | {
            type: "event-group";
            id: string;
            events: ChatAcpEvent[];
          }
      > = [];
      let pendingEvents: ChatAcpEvent[] = [];

      const flushPendingEvents = () => {
        if (pendingEvents.length === 0) return;
        const visibleEvents = filterTranscriptAcpEvents(pendingEvents);
        pendingEvents = [];
        if (visibleEvents.length === 0) return;
        rows.push({
          type: "event-group",
          id: `event-group-${visibleEvents[0]!.id}-${visibleEvents[visibleEvents.length - 1]!.id}`,
          events: visibleEvents,
        });
      };

      for (const item of timelineItems) {
        if (item.type === "event") {
          pendingEvents.push(item.event);
          continue;
        }

        flushPendingEvents();
        rows.push({
          type: "message",
          id: item.id,
          message: item.message,
          messageIndex: item.messageIndex,
        });
      }

      flushPendingEvents();
      return rows;
    }, [timelineItems]);

    // Get recent chats excluding the current one (title "New Chat" means it's empty/unused)
    const recentChats = useMemo(
      () =>
        chats
          .filter(
            (chat) =>
              chat.id !== chatState.currentChatId && chat.title !== getDefaultChatTitle(surface),
          )
          .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
          .slice(0, 5),
      [chats, chatState.currentChatId, surface],
    );

    if (messages.length === 0 && !hasPersistedAcpActivity) {
      if (recentChats.length === 0) {
        return null;
      }

      return (
        <div className="flex min-h-full flex-col items-center justify-center px-4 py-16 opacity-80">
          <div className="mb-8 w-full max-w-lg text-center">
            <h3 className="font-semibold text-lg text-text">
              {surface === "harness" ? "What are we building?" : "Start a conversation"}
            </h3>
            <p className="mt-2 text-sm text-text-lighter/80">
              The conversation canvas is ready. Use @ to reference files.
            </p>
          </div>

          <div className="w-full max-w-lg">
            <div className="mb-4 flex items-center justify-center gap-2 font-medium text-[11px] text-text-lighter uppercase tracking-[0.16em]">
              <MessageSquare size={12} />
              <span>{surface === "harness" ? "Recent Sessions" : "Recent Chats"}</span>
            </div>
            <div className="flex flex-col gap-2">
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => chatActions.switchToChat(chat.id)}
                  className="flex w-full items-center gap-4 rounded-2xl bg-primary-bg/20 px-4 py-3 text-left transition-colors hover:bg-secondary-bg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[13px] text-text">{chat.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-lighter/60">
                      <span>{getAgentLabel(chat.agentId)}</span>
                      <span>•</span>
                      <span>{getRelativeTime(chat.lastMessageAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {planEntries.length > 0 ? (
          <div className="px-3 pt-3 pb-1 sm:px-4">
            <div className="py-1">
              <div className="mb-2 flex items-center justify-between gap-3 opacity-70">
                <div className="inline-flex items-center gap-1.5 font-medium text-[11px] uppercase tracking-[0.16em]">
                  <ListTodo size={11} />
                  <span>Plan</span>
                </div>
                <div className="text-[11px]">
                  {planCounts.completed}/{planCounts.total} done
                  {planCounts.inProgress > 0 ? ` · ${planCounts.inProgress} active` : ""}
                </div>
              </div>
              {planEntries.map((entry, index) => {
                const tone = getPlanStatusTone(entry.status);
                return (
                  <div
                    key={`${entry.content}-${index}`}
                    className="flex items-start gap-2 text-[13px]"
                  >
                    <tone.Icon size={12} className={cn("mt-0.5 shrink-0", tone.className)} />
                    <span
                      className={cn(
                        "min-w-0 flex-1",
                        entry.status === "completed"
                          ? "text-text-lighter/60 line-through"
                          : "text-text",
                      )}
                    >
                      {entry.content}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {timelineRows.map((row) => {
          if (row.type === "message") {
            const message = row.message;
            const index = row.messageIndex;
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
                  ? "px-3 py-1 sm:px-4"
                  : "px-3 pt-2 pb-1 sm:px-4"
                : "px-3 py-2.5 sm:px-4",
              isPlanMessage && "pt-2",
            );

            return (
              <div key={row.id} className={messageClassName}>
                <ChatMessage
                  message={message}
                  isLastMessage={index === messages.length - 1}
                  onApplyCode={onApplyCode}
                  surface={surface}
                  scopeId={scopeId}
                />
              </div>
            );
          }

          const events = row.events;
          const groupLabel = getTranscriptAcpEventGroupLabel(events);
          const hasStructuredToolEvent = events.some(isStructuredToolEvent);

          return (
            <div key={row.id} className="px-3 py-1.5 sm:px-4">
              <div className="flex flex-col gap-1 opacity-70 transition-opacity hover:opacity-100">
                <div className="mb-1 flex items-center gap-2 text-text-lighter/60">
                  <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]">
                    {hasStructuredToolEvent ? <Wrench size={10} /> : <Sparkles size={10} />}
                    <span className="font-medium">{groupLabel}</span>
                  </div>
                </div>

                <div className="space-y-1.5 pl-0.5">
                  {events.map((event) => {
                    const statusIcon = getEventStatusIcon(event.state);
                    const StatusIcon = statusIcon.Icon;
                    const detail = getVisibleEventDetail(event);

                    if (isStructuredToolEvent(event)) {
                      return (
                        <div key={event.id} className="py-1 text-sm text-text-lighter">
                          <ToolCallDisplay
                            toolName={event.label}
                            input={event.tool?.input}
                            output={event.tool?.output}
                            error={event.tool?.error}
                            isStreaming={event.state === "running"}
                            onOpenInEditor={(filePath) => handleFileSelect(filePath, false)}
                          />
                          {event.tool?.locations?.length ? (
                            <div className="mt-1 flex flex-wrap gap-1 pl-2">
                              {event.tool.locations.map((location) => (
                                <button
                                  key={`${event.id}-${location.path}-${location.line ?? 0}`}
                                  onClick={() => handleFileSelect(location.path, false)}
                                  className="rounded px-1 py-0.5 text-[10px] text-text-lighter transition-colors hover:bg-hover"
                                  title={location.path}
                                >
                                  {location.path.split("/").pop()}
                                  {location.line ? `:${location.line}` : ""}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={event.id}
                        className="flex items-start gap-2 py-0.5 text-[12px] text-text-lighter"
                      >
                        <StatusIcon
                          size={12}
                          className={cn(
                            "mt-0.5 shrink-0",
                            statusIcon.className,
                            statusIcon.spin && "animate-spin",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-text">{event.label}</span>
                          {detail ? <span className="ml-1 opacity-80">{detail}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={ref} />
      </>
    );
  }),
);

import { AlertCircle, CheckCircle, Clock, ListTodo, MessageSquare, Wrench } from "lucide-react";
import { forwardRef, memo, useMemo } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import { getAcpPlanEntryCounts, getRecentAcpToolEvents } from "@/features/ai/lib/chat-acp-activity";
import { filterChatsForScope, getDefaultChatTitle } from "@/features/ai/lib/chat-scope";
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

const getPlanStatusTone = (status: "pending" | "in_progress" | "completed"): string => {
  switch (status) {
    case "completed":
      return "border-green-500/20 bg-green-500/10 text-green-300";
    case "in_progress":
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
    default:
      return "border-border bg-primary-bg/80 text-text-lighter";
  }
};

const getTimestampMs = (value: Date | string): number => {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

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
    const recentToolEvents = useMemo(
      () => getRecentAcpToolEvents(currentChat?.acpActivity),
      [currentChat],
    );
    const hasPersistedAcpActivity = planEntries.length > 0 || recentToolEvents.length > 0;
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
        if (surface === "harness") {
          return (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md rounded-3xl border border-border bg-primary-bg/90 px-6 py-5 text-center">
                <div className="font-medium text-sm text-text">Harness is ready</div>
                <div className="mt-2 text-text-lighter text-xs">
                  Describe the task, mention project files with <code>@</code>, or use a slash
                  command to start a new session.
                </div>
              </div>
            </div>
          );
        }

        return null;
      }

      return (
        <div className="flex h-full flex-col items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-primary-bg/90 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-text-lighter text-xs">
              <MessageSquare size={12} />
              <span>{surface === "harness" ? "Recent Sessions" : "Recent Chats"}</span>
            </div>
            <div className="space-y-1">
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => chatActions.switchToChat(chat.id)}
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
        {hasPersistedAcpActivity ? (
          <div className="px-4 pt-3 pb-1">
            <div className="mb-2 text-[10px] text-text-lighter uppercase tracking-[0.12em]">
              Session activity
            </div>
            <div className="space-y-2">
              {planEntries.length > 0 ? (
                <div className="rounded-2xl border border-border bg-secondary-bg/80 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 text-[10px] text-text-lighter uppercase tracking-[0.12em]">
                      <ListTodo size={11} />
                      Plan
                    </div>
                    <div className="text-[10px] text-text-lighter">
                      {planCounts.completed}/{planCounts.total} done
                      {planCounts.inProgress > 0 ? ` · ${planCounts.inProgress} active` : ""}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {planEntries.map((entry, index) => (
                      <div
                        key={`${entry.content}-${index}`}
                        className="flex items-start gap-2 rounded-xl border border-border/70 bg-primary-bg/70 px-2.5 py-2 text-xs"
                      >
                        <span
                          className={cn(
                            "mt-0.5 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            getPlanStatusTone(entry.status),
                          )}
                        >
                          {entry.status.replace("_", " ")}
                        </span>
                        <span className="min-w-0 flex-1 text-text">{entry.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {recentToolEvents.length > 0 ? (
                <div className="rounded-2xl border border-border bg-secondary-bg/80 px-3 py-2.5">
                  <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] text-text-lighter uppercase tracking-[0.12em]">
                    <Wrench size={11} />
                    Tool activity
                  </div>
                  <div className="space-y-1.5">
                    {recentToolEvents.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-xl border border-border/70 bg-primary-bg/70 px-2.5 py-2"
                      >
                        <ToolCallDisplay
                          toolName={event.label}
                          input={event.tool?.input}
                          output={event.tool?.output}
                          error={event.tool?.error}
                          isStreaming={event.state === "running"}
                          onOpenInEditor={(filePath) => handleFileSelect(filePath, false)}
                        />
                        {event.tool?.locations?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1 pl-3">
                            {event.tool.locations.map((location) => (
                              <button
                                key={`${event.id}-${location.path}-${location.line ?? 0}`}
                                onClick={() => handleFileSelect(location.path, false)}
                                className="rounded-full border border-border bg-secondary-bg/80 px-2 py-1 text-[10px] text-text-lighter transition-colors hover:bg-hover hover:text-text"
                                title={location.path}
                              >
                                {location.path.split("/").pop()}
                                {location.line ? `:${location.line}` : ""}
                              </button>
                            ))}
                          </div>
                        ) : getVisibleEventDetail(event) ? (
                          <div className="mt-1 pl-3 text-[11px] text-text-lighter">
                            {getVisibleEventDetail(event)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

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
                  surface={surface}
                  scopeId={scopeId}
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

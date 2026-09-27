import {
  ArrowClockwiseIcon,
  ClipboardTextIcon,
  CopyIcon,
  FileTextIcon,
  PencilIcon,
} from "@/ui/icons";
import type { FormEvent, ReactNode } from "react";
import { memo, useCallback, useEffect, useState } from "react";
import { Shimmer } from "@/ui/shimmer";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { MessageAction, MessageResponse } from "@/ui/message";
import { ThinkingOrb, type ThinkingOrbProps } from "@/ui/thinking-orb";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import type { Message as AIMessage } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
import { elapsedSeconds, formatElapsed } from "@/features/ai/lib/elapsed-time";
import { buildShareableOutcomeMarkdown } from "@/features/ai/lib/shareable-outcome";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { badgeVariants } from "@/ui/badge";
import { isComposingKeyboardEvent } from "@/features/keymaps/utils/is-composing-keyboard-event";
import { Button } from "@/ui/button";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/ui/attachment";
import { Bubble, BubbleContent } from "@/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/ui/message";
import Textarea from "@/ui/textarea";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import { AgentPlan } from "../messages/agent-plan";
import { AgentStopNotice } from "../messages/agent-stop-notice";
import { ChatErrorBlock } from "../messages/chat-error-block";
import { ToolCallList } from "../messages/tool-call-display";
import { buildAssistantSegments } from "@/features/ai/lib/assistant-segments";
import { stripErrorBlocks } from "@/features/ai/lib/chat-error";
import { findLatestEdit } from "@/features/ai/lib/tool-call-groups";
import { describeTurnUsage, formatTurnUsage } from "@/features/ai/lib/acp-usage";
import { formatMessageUsage } from "@/features/ai/lib/message-usage";
import Tooltip from "@/ui/tooltip";
import { parseMentionTokens } from "@/features/ai/lib/file-mentions";

interface ChatMessageProps {
  onRetry?: () => void | Promise<void>;
  /** Starts the turn over when the agent has not answered for a while. */
  onRetryStalled?: () => void;
  message: AIMessage;
  isLastMessage: boolean;
  showActions?: boolean;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  canEditUserMessage?: boolean;
  searchQuery?: string;
  chatId?: string | null;
  onExecutePlanStep?: (message: string) => void | Promise<void>;
}

async function copyText(text: string) {
  await writeClipboardText(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedPlainText({ text, query }: { text: string; query: string }) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return text;

  const matcher = new RegExp(`(${escapeRegExp(trimmedQuery)})`, "gi");
  const parts = text.split(matcher);

  return (
    <>
      {parts.map((part, index): ReactNode => {
        if (!part) return null;
        if (part.toLowerCase() !== trimmedQuery.toLowerCase()) return part;

        return (
          <mark key={`${part}-${index}`} className="rounded bg-primary-soft px-0.5 text-inherit">
            {part}
          </mark>
        );
      })}
    </>
  );
}

// The composer serializes an @file chip as a mention token; show it as a chip again.
function UserMessageText({ text, query }: { text: string; query: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const token of parseMentionTokens(text)) {
    const index = token.start;
    if (index > cursor) {
      parts.push(
        <HighlightedPlainText
          key={`text-${cursor}`}
          text={text.slice(cursor, index)}
          query={query}
        />,
      );
    }
    parts.push(
      <span
        key={`mention-${index}`}
        data-mention="true"
        title={token.path}
        className={cn(badgeVariants({ tone: "accent" }), "max-w-48 truncate align-baseline")}
      >
        {token.name}
      </span>,
    );
    cursor = token.end;
  }
  if (cursor < text.length) {
    parts.push(
      <HighlightedPlainText key={`text-${cursor}`} text={text.slice(cursor)} query={query} />,
    );
  }
  return <>{parts}</>;
}

/** Seconds since `since`, ticking once a second while mounted. */
function useElapsedSeconds(since: Date | string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return elapsedSeconds(since, now);
}

function ChatResponseStatus({
  phase,
  since,
  onRetry,
}: {
  phase: AIMessage["responsePhase"];
  since: Date | string;
  onRetry?: () => void;
}) {
  const elapsed = useElapsedSeconds(since);
  const isStarting = phase === "starting";
  const isThinking = phase === "thinking";
  const isStalled = phase === "stalled";
  const label = isStarting
    ? "Starting agent…"
    : isThinking
      ? "Thinking…"
      : isStalled
        ? "Still waiting for the agent…"
        : "Waiting for response…";
  const state: ThinkingOrbProps["state"] = isThinking ? "breathing" : "connecting";

  return (
    <Marker role="status" className="w-fit">
      <MarkerIcon className="size-5">
        <ThinkingOrb state={state} size={20} aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent className="flex items-center gap-2">
        <Shimmer>{label}</Shimmer>
        {elapsed > 0 ? <span className="tabular-nums">{formatElapsed(elapsed)}</span> : null}
      </MarkerContent>
      {isStalled && onRetry ? (
        <Button type="button" variant="ghost" onClick={onRetry}>
          <ArrowClockwiseIcon />
          Retry
        </Button>
      ) : null}
    </Marker>
  );
}

/** Matches the user bubble's `px-3` so both text columns start on the same x. */
const ASSISTANT_CONTENT_INSET = "px-3";

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastMessage,
  showActions = true,
  onRetry,
  onRetryStalled,
  onEditUserMessage,
  canEditUserMessage = false,
  searchQuery = "",
  chatId,
  onExecutePlanStep,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(message.content);
  // A turn that failed keeps a legacy error card in its text for saved chats; the structured
  // error renders instead, so the card is left out.
  const responseText = message.error ? stripErrorBlocks(message.content) : message.content;
  const isToolOnlyMessage =
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    !responseText.trim();

  const handleExecuteStep = useCallback(
    (step: PlanStep, stepIndex: number) => {
      void onExecutePlanStep?.(
        `Execute step ${stepIndex + 1} of the plan: ${step.title}\n\n${step.description}`,
      );
    },
    [onExecutePlanStep],
  );

  // Only the newest edit of the latest reply opens its diff on its own.
  const latestEdit = isLastMessage ? findLatestEdit(message.toolCalls) : null;

  if (message.role === "user") {
    const messageTime = formatTime(message.timestamp);
    const startEditing = () => {
      setDraftContent(message.content);
      setIsEditing(true);
    };
    const cancelEditing = () => {
      setDraftContent(message.content);
      setIsEditing(false);
    };
    const submitEdit = () => {
      const nextContent = draftContent.trim();
      if (!nextContent || nextContent === message.content) {
        cancelEditing();
        return;
      }

      setIsEditing(false);
      void onEditUserMessage?.(message.id, nextContent);
    };
    const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitEdit();
    };

    return (
      <Message>
        <MessageContent>
          <Bubble variant="user">
            <BubbleContent title={messageTime} className="w-full">
              {isEditing ? (
                <form onSubmit={handleEditSubmit} className="flex min-w-0 flex-col gap-2">
                  <Textarea
                    autoFocus
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    onFocus={(event) => {
                      const end = event.currentTarget.value.length;
                      event.currentTarget.setSelectionRange(end, end);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEditing();
                        return;
                      }
                      if (event.key !== "Enter" || isComposingKeyboardEvent(event.nativeEvent)) {
                        return;
                      }
                      // Enter sends like the composer does; Shift+Enter keeps a newline.
                      if (!event.shiftKey || event.metaKey || event.ctrlKey) {
                        event.preventDefault();
                        submitEdit();
                      }
                    }}
                    variant="ghost"
                    inset="flush"
                    font="inherit"
                    resize="none"
                    autoSize
                    aria-label="Edit prompt"
                  />
                  <div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" onClick={cancelEditing}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="accent" disabled={!draftContent.trim()}>
                      Send
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="select-text whitespace-pre-wrap wrap-break-word">
                  <UserMessageText text={message.content} query={searchQuery} />
                </div>
              )}
            </BubbleContent>
          </Bubble>
          {isEditing || !showActions ? null : (
            <MessageFooter reserveSpace={false}>
              <span>{messageTime}</span>
              <MessageAction onClick={() => void copyText(message.content)} label="Copy prompt">
                <CopyIcon className="size-3.5" />
              </MessageAction>
              {canEditUserMessage && onEditUserMessage ? (
                <MessageAction onClick={startEditing} label="Edit prompt" icon={PencilIcon} />
              ) : null}
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  }

  if (isToolOnlyMessage) {
    return (
      <Message>
        <MessageContent className={ASSISTANT_CONTENT_INSET}>
          <ToolCallList
            toolCalls={message.toolCalls!}
            isStreaming={message.isStreaming}
            latestEdit={latestEdit}
          />
          {message.error ? (
            <ChatErrorBlock error={message.error} chatId={chatId} onRetry={onRetry} />
          ) : null}
          {message.stopNotice ? <AgentStopNotice notice={message.stopNotice} /> : null}
        </MessageContent>
      </Message>
    );
  }

  if (
    message.role === "assistant" &&
    message.isStreaming &&
    !message.error &&
    (!message.content || message.content.trim().length === 0) &&
    (!message.toolCalls || message.toolCalls.length === 0)
  ) {
    return (
      <Message className="items-center">
        <MessageContent className={ASSISTANT_CONTENT_INSET}>
          <ChatResponseStatus
            phase={message.responsePhase}
            since={message.timestamp}
            onRetry={onRetryStalled}
          />
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message>
      <MessageContent className={ASSISTANT_CONTENT_INSET}>
        <Bubble variant="ghost">
          <BubbleContent>
            {message.images?.length || message.resources?.length ? (
              <AttachmentGroup className="mb-2">
                {message.images?.map((image, index) => (
                  <Attachment key={`${message.id}-image-${index}`} orientation="vertical">
                    <AttachmentMedia variant="image">
                      <img
                        src={`data:${image.mediaType};base64,${image.data}`}
                        alt={`AI generated content ${index + 1}`}
                      />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>Generated image {index + 1}</AttachmentTitle>
                      <AttachmentDescription>{image.mediaType}</AttachmentDescription>
                    </AttachmentContent>
                  </Attachment>
                ))}
                {message.resources?.map((resource, index) => {
                  const resourceName = resource.name || resource.uri;

                  return (
                    <Attachment key={`${message.id}-resource-${index}`}>
                      <AttachmentMedia>
                        <FileTextIcon />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{resourceName}</AttachmentTitle>
                        <AttachmentDescription>{resource.uri}</AttachmentDescription>
                      </AttachmentContent>
                      <AttachmentTrigger
                        render={
                          <a
                            href={resource.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${resourceName}`}
                          />
                        }
                      />
                    </Attachment>
                  );
                })}
              </AttachmentGroup>
            ) : null}

            {message.ui && message.ui.length > 0 && (
              <div className="mb-2 space-y-2">
                {message.ui.map((component, index) => (
                  <GenerativeUIRenderer key={`${message.id}-ui-${index}`} component={component} />
                ))}
              </div>
            )}

            {message.plan?.length ? (
              <AgentPlan entries={message.plan} isStreaming={message.isStreaming} />
            ) : null}

            {buildAssistantSegments(responseText, message.toolCalls).map((segment, index) => (
              <div
                key={`${message.id}-segment-${index}`}
                className={cn("flex min-w-0 flex-col gap-2", index > 0 && "mt-2")}
              >
                {segment.plan ? (
                  <MessageResponse>
                    <PlanBlockDisplay
                      plan={segment.plan}
                      isStreaming={message.isStreaming}
                      onExecuteStep={handleExecuteStep}
                    />
                  </MessageResponse>
                ) : segment.text ? (
                  <MessageResponse>
                    <MarkdownRenderer onRetry={onRetry} content={segment.text} chatId={chatId} />
                  </MessageResponse>
                ) : null}
                {segment.toolCalls.length > 0 ? (
                  <ToolCallList
                    toolCalls={segment.toolCalls}
                    isStreaming={message.isStreaming}
                    latestEdit={latestEdit}
                  />
                ) : null}
              </div>
            ))}
            {message.error ? (
              <ChatErrorBlock error={message.error} chatId={chatId} onRetry={onRetry} />
            ) : null}
            {message.stopNotice ? <AgentStopNotice notice={message.stopNotice} /> : null}
          </BubbleContent>
        </Bubble>
        {showActions && responseText.trim() ? (
          <MessageFooter reserveSpace={false}>
            <MessageAction onClick={() => void copyText(responseText)} label="Copy response">
              <CopyIcon className="size-3.5" />
            </MessageAction>
            {isLastMessage && !message.isStreaming ? (
              <MessageAction
                onClick={() => void copyText(buildShareableOutcomeMarkdown(responseText))}
                label="Copy outcome as Markdown"
                icon={ClipboardTextIcon}
              />
            ) : null}
            {message.turnUsage ? (
              <Tooltip content={describeTurnUsage(message.turnUsage)}>
                <span className="px-1 tabular-nums">{formatTurnUsage(message.turnUsage)}</span>
              </Tooltip>
            ) : null}
            {message.usage && formatMessageUsage(message.usage) ? (
              <span className="px-1 tabular-nums">{formatMessageUsage(message.usage)}</span>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
});

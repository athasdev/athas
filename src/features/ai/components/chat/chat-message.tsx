import {
  CopySimpleIcon as CopySimple,
  FileTextIcon as FileText,
  UploadSimpleIcon as Share,
} from "@/ui/icons";
import type { FormEvent, ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { MessageAction, MessageResponse } from "@/ui/message";
import { ThinkingOrb, type ThinkingOrbProps } from "@/ui/thinking-orb";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message as AIMessage } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
import { buildShareableOutcomeMarkdown } from "@/features/ai/lib/shareable-outcome";
import { writeClipboardText } from "@/utils/clipboard";
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
import { Avatar } from "@/ui/avatar";
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/ui/message";
import Textarea from "@/ui/textarea";
import { ProviderIcon } from "../icons/provider-icons";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import { ToolCallGroupDisplay } from "../messages/tool-call-display";

interface ChatMessageProps {
  message: AIMessage;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  canEditUserMessage?: boolean;
  searchQuery?: string;
  chatId?: string | null;
  onExecutePlanStep?: (message: string) => void | Promise<void>;
  userName: string;
  userAvatarUrl?: string | null;
  assistantIconId: string;
  assistantLabel: string;
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
          <mark key={`${part}-${index}`} className="rounded bg-primary/25 px-0.5 text-inherit">
            {part}
          </mark>
        );
      })}
    </>
  );
}

function ChatResponseStatus({ phase }: { phase: AIMessage["responsePhase"] }) {
  const isStarting = phase === "starting";
  const isThinking = phase === "thinking";
  const label = isStarting ? "Starting agent…" : isThinking ? "Thinking…" : "Waiting for response…";
  const state: ThinkingOrbProps["state"] = isThinking ? "breathing" : "connecting";

  return (
    <Marker role="status" className="w-fit">
      <MarkerIcon className="size-5">
        <ThinkingOrb state={state} size={20} aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent className="text-shimmer">{label}</MarkerContent>
    </Marker>
  );
}

function AssistantMessageAvatar({ iconId, label }: { iconId: string; label: string }) {
  return (
    <MessageAvatar
      placement="content"
      variant="assistant"
      size="compact"
      className="mt-1.5"
      title={label}
      aria-label={label}
    >
      <ProviderIcon providerId={iconId} />
    </MessageAvatar>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastMessage,
  onApplyCode,
  onEditUserMessage,
  canEditUserMessage = false,
  searchQuery = "",
  chatId,
  onExecutePlanStep,
  userName,
  userAvatarUrl,
  assistantIconId,
  assistantLabel,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(message.content);
  const isToolOnlyMessage =
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    (!message.content || message.content.trim().length === 0);

  const handleExecuteStep = useCallback(
    (step: PlanStep, stepIndex: number) => {
      void onExecutePlanStep?.(
        `Execute step ${stepIndex + 1} of the plan: ${step.title}\n\n${step.description}`,
      );
    },
    [onExecutePlanStep],
  );

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
    const submitEdit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextContent = draftContent.trim();
      if (!nextContent || nextContent === message.content) {
        cancelEditing();
        return;
      }

      setIsEditing(false);
      void onEditUserMessage?.(message.id, nextContent);
    };

    return (
      <Message>
        <MessageAvatar placement="content" size="compact" className="mt-0.5">
          <Avatar name={userName} src={userAvatarUrl} className="size-full" />
        </MessageAvatar>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent title={messageTime} className="w-full">
              {isEditing ? (
                <form onSubmit={submitEdit} className="flex min-w-0 flex-col gap-2">
                  <Textarea
                    autoFocus
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEditing();
                      }
                    }}
                    variant="ghost"
                    inset="flush"
                    className="min-h-16 resize-y"
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
              ) : canEditUserMessage && onEditUserMessage ? (
                <button
                  type="button"
                  onClick={startEditing}
                  className="block w-full cursor-text text-left whitespace-pre-wrap wrap-break-word select-text"
                  aria-label="Edit prompt"
                >
                  <HighlightedPlainText text={message.content} query={searchQuery} />
                </button>
              ) : (
                <div className="select-text whitespace-pre-wrap wrap-break-word">
                  <HighlightedPlainText text={message.content} query={searchQuery} />
                </div>
              )}
            </BubbleContent>
          </Bubble>
          {isEditing ? null : (
            <MessageFooter reserveSpace={false}>
              <span>{messageTime}</span>
              <MessageAction onClick={() => void copyText(message.content)} label="Copy prompt">
                <CopySimple className="size-3.5" />
              </MessageAction>
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  }

  if (isToolOnlyMessage) {
    return (
      <Message>
        <AssistantMessageAvatar iconId={assistantIconId} label={assistantLabel} />
        <MessageContent>
          <ToolCallGroupDisplay toolCalls={message.toolCalls!} isStreaming={message.isStreaming} />
        </MessageContent>
      </Message>
    );
  }

  if (
    message.role === "assistant" &&
    message.isStreaming &&
    (!message.content || message.content.trim().length === 0) &&
    (!message.toolCalls || message.toolCalls.length === 0)
  ) {
    return (
      <Message>
        <AssistantMessageAvatar iconId={assistantIconId} label={assistantLabel} />
        <MessageContent>
          <ChatResponseStatus phase={message.responsePhase} />
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message>
      <AssistantMessageAvatar iconId={assistantIconId} label={assistantLabel} />
      <MessageContent>
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
                        <FileText />
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

            {message.content && (
              <MessageResponse>
                {hasPlanBlock(message.content) ? (
                  <PlanBlockDisplay
                    plan={parsePlan(message.content)!}
                    isStreaming={message.isStreaming}
                    onExecuteStep={handleExecuteStep}
                  />
                ) : (
                  <MarkdownRenderer
                    content={message.content}
                    onApplyCode={onApplyCode}
                    chatId={chatId}
                  />
                )}
              </MessageResponse>
            )}

            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2">
                <ToolCallGroupDisplay
                  toolCalls={message.toolCalls}
                  isStreaming={message.isStreaming}
                />
              </div>
            )}
          </BubbleContent>
        </Bubble>
        {message.content.trim() ? (
          <MessageFooter reserveSpace={false}>
            <MessageAction onClick={() => void copyText(message.content)} label="Copy response">
              <CopySimple className="size-3.5" />
            </MessageAction>
            {isLastMessage && !message.isStreaming ? (
              <MessageAction
                onClick={() => void copyText(buildShareableOutcomeMarkdown(message.content))}
                label="Copy outcome as Markdown"
                icon={Share}
              />
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
});

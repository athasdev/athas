import {
  CopySimpleIcon as CopySimple,
  FileTextIcon as FileText,
  PencilSimpleIcon as PencilSimple,
} from "@/ui/icons";
import type { FormEvent, ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { MessageAction, MessageResponse } from "@/features/ai/components/elements/message";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message as AIMessage } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
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
import { Message, MessageContent, MessageFooter } from "@/ui/message";
import Textarea from "@/ui/textarea";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import { ToolCallGroupDisplay } from "../messages/tool-call-display";
import { ChatLoadingIndicator } from "./chat-loading-indicator";

interface ChatMessageProps {
  message: AIMessage;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
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
          <mark key={`${part}-${index}`} className="rounded bg-accent/25 px-0.5 text-inherit">
            {part}
          </mark>
        );
      })}
    </>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  onApplyCode,
  onEditUserMessage,
  canEditUserMessage = false,
  searchQuery = "",
  chatId,
  onExecutePlanStep,
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
      <Message align="end">
        <MessageContent>
          <Bubble
            variant="secondary"
            align="end"
            className={isEditing ? "w-full max-w-[80%]" : undefined}
          >
            <BubbleContent title={messageTime} className={isEditing ? "w-full" : undefined}>
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
                    className="min-h-16 resize-y p-0"
                    aria-label="Edit prompt"
                  />
                  <div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="xs" onClick={cancelEditing}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="accent"
                      size="xs"
                      disabled={!draftContent.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="ai-chat-message-content whitespace-pre-wrap break-words">
                  <HighlightedPlainText text={message.content} query={searchQuery} />
                </div>
              )}
            </BubbleContent>
          </Bubble>
          {isEditing ? null : (
            <MessageFooter>
              <span>{messageTime}</span>
              <MessageAction
                onClick={() => void copyText(message.content)}
                label="Copy prompt"
                className="hover:bg-transparent hover:text-text-lighter"
              >
                <CopySimple className="size-3.5" />
              </MessageAction>
              {canEditUserMessage && onEditUserMessage ? (
                <MessageAction
                  onClick={startEditing}
                  label="Edit prompt"
                  className="hover:bg-transparent hover:text-text-lighter"
                >
                  <PencilSimple className="size-3.5" />
                </MessageAction>
              ) : null}
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  }

  if (isToolOnlyMessage) {
    return (
      <div>
        <ToolCallGroupDisplay toolCalls={message.toolCalls!} isStreaming={message.isStreaming} />
      </div>
    );
  }

  if (
    message.role === "assistant" &&
    message.isStreaming &&
    (!message.content || message.content.trim().length === 0) &&
    (!message.toolCalls || message.toolCalls.length === 0)
  ) {
    return <ChatLoadingIndicator label="Thinking…" compact />;
  }

  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent>
            {message.images?.length || message.resources?.length ? (
              <AttachmentGroup className="mb-2">
                {message.images?.map((image, index) => (
                  <Attachment key={`${message.id}-image-${index}`} orientation="vertical" size="sm">
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
                    <Attachment key={`${message.id}-resource-${index}`} size="sm">
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
          <MessageFooter className="opacity-100 transition-opacity md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100">
            <MessageAction
              onClick={() => void copyText(message.content)}
              label="Copy response"
              className="hover:bg-transparent hover:text-text-lighter"
            >
              <CopySimple className="size-3.5" />
            </MessageAction>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
});

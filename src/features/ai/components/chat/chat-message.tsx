import { CopySimpleIcon as CopySimple, FileTextIcon as FileText } from "@/ui/icons";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { MessageAction, MessageResponse } from "@/features/ai/components/elements/message";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message as AIMessage } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
import { writeClipboardText } from "@/utils/clipboard";
import { useAIChatStore } from "../../stores/ai-chat.store";
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
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import { ToolCallGroupDisplay } from "../messages/tool-call-display";
import { ChatLoadingIndicator } from "./chat-loading-indicator";

interface ChatMessageProps {
  message: AIMessage;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
  searchQuery?: string;
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
  searchQuery = "",
}: ChatMessageProps) {
  const isToolOnlyMessage =
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    (!message.content || message.content.trim().length === 0);

  const handleExecuteStep = useCallback((step: PlanStep, stepIndex: number) => {
    const { setMode, addMessageToQueue } = useAIChatStore.getState();
    setMode("chat");
    addMessageToQueue(
      `Execute step ${stepIndex + 1} of the plan: ${step.title}\n\n${step.description}`,
    );
  }, []);

  if (message.role === "user") {
    const messageTime = formatTime(message.timestamp);

    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent title={messageTime}>
              <div className="ai-chat-message-content whitespace-pre-wrap break-words">
                <HighlightedPlainText text={message.content} query={searchQuery} />
              </div>
            </BubbleContent>
          </Bubble>
          <MessageFooter>
            <span>{messageTime}</span>
            <MessageAction
              onClick={() => void copyText(message.content)}
              label="Copy prompt"
              className="hover:bg-transparent hover:text-text-lighter"
            >
              <CopySimple className="size-3.5" />
            </MessageAction>
          </MessageFooter>
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
                  <MarkdownRenderer content={message.content} onApplyCode={onApplyCode} />
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
      </MessageContent>
    </Message>
  );
});

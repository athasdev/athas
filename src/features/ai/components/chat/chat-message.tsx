import { CopySimpleIcon as CopySimple } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import {
  MessageAction,
  MessageContent,
  MessageMeta,
  Message as MessageRoot,
  MessageResponse,
} from "@/features/ai/components/elements/message";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message as AIMessage } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
import { writeClipboardText } from "@/utils/clipboard";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
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
      <MessageRoot from="user" className="flex-col items-end">
        <MessageContent from="user" title={messageTime}>
          <div className="ai-chat-message-content whitespace-pre-wrap break-words">
            <HighlightedPlainText text={message.content} query={searchQuery} />
          </div>
        </MessageContent>
        <MessageMeta>
          <span className="ui-text-sm text-text-lighter/55">{messageTime}</span>
          <MessageAction
            onClick={() => void copyText(message.content)}
            label="Copy prompt"
            className="hover:bg-transparent hover:text-text-lighter"
          >
            <CopySimple className="size-3.5" />
          </MessageAction>
        </MessageMeta>
      </MessageRoot>
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
    return <ChatLoadingIndicator label="waiting for response" compact />;
  }

  return (
    <MessageRoot from="assistant" className="relative">
      <MessageContent from="assistant">
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((image, index) => (
              <img
                key={`${message.id}-image-${index}`}
                src={`data:${image.mediaType};base64,${image.data}`}
                alt={`AI generated content ${index + 1}`}
                className="max-h-64 max-w-full rounded-lg border border-border"
              />
            ))}
          </div>
        )}

        {message.resources && message.resources.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.resources.map((resource, index) => (
              <a
                key={`${message.id}-resource-${index}`}
                href={resource.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border bg-primary-bg/50 px-2 py-1 text-accent ui-text-sm hover:bg-hover"
              >
                <span className="truncate">{resource.name || resource.uri}</span>
              </a>
            ))}
          </div>
        )}

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
            <ToolCallGroupDisplay toolCalls={message.toolCalls} isStreaming={message.isStreaming} />
          </div>
        )}
      </MessageContent>
    </MessageRoot>
  );
});

import { CopySimpleIcon as CopySimple } from "@phosphor-icons/react";
import { memo, useCallback } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message } from "@/features/ai/types/ai-chat.types";
import { formatTime } from "@/features/ai/lib/formatting";
import { Button } from "@/ui/button";
import { writeClipboardText } from "@/utils/clipboard";
import { useAIChatStore } from "../../stores/ai-chat.store";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import { ToolCallGroupDisplay } from "../messages/tool-call-display";
import { ChatLoadingIndicator } from "./chat-loading-indicator";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
}

async function copyText(text: string) {
  await writeClipboardText(text);
}

export const ChatMessage = memo(function ChatMessage({ message, onApplyCode }: ChatMessageProps) {
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
      <div className="group flex w-full flex-col items-end">
        <div
          className="inline-block max-w-[min(72ch,100%)] rounded-2xl bg-secondary-bg/42 px-3 py-2.5"
          title={messageTime}
        >
          <div className="ai-chat-message-content whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="ui-text-xs text-text-lighter/55">{messageTime}</span>
          <Button
            type="button"
            variant="ghost"
            compact
            onClick={() => void copyText(message.content)}
            className="size-6 rounded-md border-transparent bg-transparent p-0 text-text-lighter/55 shadow-none hover:bg-transparent hover:text-text-lighter"
            aria-label="Copy prompt"
          >
            <CopySimple className="size-3.5" />
          </Button>
        </div>
      </div>
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
    <div className="group relative w-full">
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
              className="inline-flex items-center gap-1 rounded border border-border bg-primary-bg/50 px-2 py-1 text-accent ui-text-xs hover:bg-hover"
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
        <>
          <div className="ai-chat-message-content pr-1 leading-relaxed">
            {hasPlanBlock(message.content) ? (
              <PlanBlockDisplay
                plan={parsePlan(message.content)!}
                isStreaming={message.isStreaming}
                onExecuteStep={handleExecuteStep}
              />
            ) : (
              <MarkdownRenderer content={message.content} onApplyCode={onApplyCode} />
            )}
          </div>
        </>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-2">
          <ToolCallGroupDisplay toolCalls={message.toolCalls} isStreaming={message.isStreaming} />
        </div>
      )}
    </div>
  );
});

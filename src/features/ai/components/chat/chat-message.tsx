import { memo, useCallback } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message } from "@/features/ai/types/ai-chat";
import { useAIChatStore } from "../../store/store";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import ToolCallDisplay from "../messages/tool-call-display";
import { ChatLoadingIndicator } from "./chat-loading-indicator";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
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
    return (
      <div className="w-full">
        <div className="relative rounded-2xl bg-secondary-bg/42 px-3 py-2.5">
          <div className="ai-chat-message-content whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  if (isToolOnlyMessage) {
    return (
      <div className="space-y-0.5">
        {message.toolCalls!.map((toolCall, toolIndex) => (
          <ToolCallDisplay
            key={`${message.id}-tool-${toolIndex}`}
            toolName={toolCall.name}
            input={toolCall.input}
            output={toolCall.output}
            error={toolCall.error}
            kind={toolCall.kind}
            status={toolCall.status}
            locations={toolCall.locations}
            isStreaming={!toolCall.isComplete && message.isStreaming}
          />
        ))}
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
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-1 space-y-0.5">
          {message.toolCalls!.map((toolCall, toolIndex) => (
            <ToolCallDisplay
              key={`${message.id}-tool-${toolIndex}`}
              toolName={toolCall.name}
              input={toolCall.input}
              output={toolCall.output}
              error={toolCall.error}
              kind={toolCall.kind}
              status={toolCall.status}
              locations={toolCall.locations}
              isStreaming={!toolCall.isComplete && message.isStreaming}
            />
          ))}
        </div>
      )}

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
              className="inline-flex items-center gap-1 rounded border border-border bg-primary-bg/50 px-2 py-1 text-accent text-xs hover:bg-hover"
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
    </div>
  );
});

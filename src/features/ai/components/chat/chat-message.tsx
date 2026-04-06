import { Check, Copy, RefreshCw, RotateCcw, Undo2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message } from "@/features/ai/types/ai-chat";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "../../store/store";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import MarkdownRenderer from "../messages/markdown-renderer";
import { PlanBlockDisplay } from "../messages/plan-block-display";
import ToolCallDisplay from "../messages/tool-call-display";

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
  onApplyCode?: (code: string, language?: string) => void;
}

function hasError(messageContent: string): boolean {
  return messageContent.includes("[ERROR_BLOCK]");
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastMessage,
  onApplyCode,
}: ChatMessageProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const getCurrentChat = useAIChatStore((state) => state.getCurrentChat);
  const currentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const regenerateResponse = useAIChatStore((state) => state.regenerateResponse);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);

  const handleOpenInEditor = useCallback(
    (filePath: string) => {
      handleFileSelect(filePath, false);
    },
    [handleFileSelect],
  );

  const isToolOnlyMessage =
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    (!message.content || message.content.trim().length === 0);
  const isAcp = isAcpAgent(currentAgentId());

  const handleCopyMessage = useCallback(async (messageContent: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(messageContent);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  }, []);

  const handleRestoreCheckpoint = useCallback(
    (messageId: string) => {
      if (!currentChatId) return;

      const chat = getCurrentChat();
      if (!chat) return;

      const messageIndex = chat.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      const updatedMessages = chat.messages.slice(0, messageIndex + 1);
      const updatedChat = {
        ...chat,
        messages: updatedMessages,
        lastMessageAt: new Date(),
      };

      const chats = useAIChatStore.getState().chats;
      const chatIndex = chats.findIndex((c) => c.id === currentChatId);
      if (chatIndex !== -1) {
        useAIChatStore.setState((state) => {
          state.chats[chatIndex] = updatedChat;
        });
      }

      useAIChatStore.getState().syncChatToDatabase(currentChatId);
    },
    [currentChatId, getCurrentChat],
  );

  const handleRetryMessage = useCallback(() => {
    const lastUserMessage = regenerateResponse();
    if (lastUserMessage) {
      useAIChatStore.getState().addMessageToQueue(lastUserMessage);
    }
  }, [regenerateResponse]);

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
        <div className="relative rounded-2xl border border-border bg-primary-bg/90 px-3 py-2.5">
          <div className="whitespace-pre-wrap break-words pr-6">{message.content}</div>
          <Tooltip content="Restore to this point" side="top">
            <Button
              onClick={() => handleRestoreCheckpoint(message.id)}
              variant="ghost"
              size="icon-xs"
              className="-translate-y-1/2 absolute top-1/2 right-1.5 rounded-full border border-border bg-secondary-bg/80 text-text-lighter opacity-40 hover:bg-hover hover:opacity-100"
              title="Restore checkpoint"
              aria-label="Restore to this checkpoint"
            >
              <Undo2 />
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  }

  if (isToolOnlyMessage) {
    if (isAcp) {
      return null;
    }

    return (
      <div className="space-y-2">
        {message.toolCalls!.map((toolCall, toolIndex) => (
          <ToolCallDisplay
            key={`${message.id}-tool-${toolIndex}`}
            toolName={toolCall.name}
            input={toolCall.input}
            output={toolCall.output}
            error={toolCall.error}
            isStreaming={!toolCall.isComplete && message.isStreaming}
            onOpenInEditor={handleOpenInEditor}
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
    if (isAcpAgent(currentAgentId())) {
      return null;
    }

    return (
      <div className="flex items-center gap-2 font-mono text-text-lighter text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-text-lighter/70" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-text-lighter/70 [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-text-lighter/70 [animation-delay:300ms]" />
        </span>
        <span>thinking...</span>
      </div>
    );
  }

  return (
    <div className="group relative w-full">
      {!isAcp && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-2 space-y-2">
          {message.toolCalls!.map((toolCall, toolIndex) => (
            <ToolCallDisplay
              key={`${message.id}-tool-${toolIndex}`}
              toolName={toolCall.name}
              input={toolCall.input}
              output={toolCall.output}
              error={toolCall.error}
              isStreaming={!toolCall.isComplete && message.isStreaming}
              onOpenInEditor={handleOpenInEditor}
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
          <div className="pr-1 leading-relaxed">
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

          <div className="pointer-events-none absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {isLastMessage &&
              (hasError(message.content) ? (
                <Tooltip content="Retry" side="top">
                  <Button
                    onClick={handleRetryMessage}
                    variant="ghost"
                    size="icon-sm"
                    className="pointer-events-auto rounded-full border border-border bg-primary-bg/90"
                    title="Retry"
                    aria-label="Retry failed message"
                  >
                    <RefreshCw />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip content="Regenerate" side="top">
                  <Button
                    onClick={handleRetryMessage}
                    variant="ghost"
                    size="icon-sm"
                    className="pointer-events-auto rounded-full border border-border bg-primary-bg/90"
                    title="Regenerate"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw />
                  </Button>
                </Tooltip>
              ))}
            <Button
              onClick={() => handleCopyMessage(message.content, message.id)}
              variant="ghost"
              size="icon-sm"
              className="pointer-events-auto rounded-full border border-border bg-primary-bg/90"
              title="Copy message"
              aria-label="Copy message"
            >
              {copiedMessageId === message.id ? <Check className="text-green-400" /> : <Copy />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
});

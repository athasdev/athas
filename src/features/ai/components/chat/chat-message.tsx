import { Check, Copy, RefreshCw, RotateCcw, Undo2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { Message } from "@/features/ai/types/ai-chat";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import Tooltip from "@/ui/tooltip";
import { isAcpAgent } from "@/utils/ai-chat";
import { useAIChatStore } from "../../store/store";
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
        <div className="relative rounded-md bg-hover px-2.5 py-2">
          <div className="whitespace-pre-wrap break-words pr-6">{message.content}</div>
          <Tooltip content="Restore to this point" side="top">
            <button
              onClick={() => handleRestoreCheckpoint(message.id)}
              className="-translate-y-1/2 absolute top-1/2 right-1 flex size-4 items-center justify-center rounded bg-primary-bg p-0.5 text-text-lighter opacity-40 transition-opacity hover:bg-secondary-bg hover:opacity-100"
              title="Restore checkpoint"
              aria-label="Restore to this checkpoint"
            >
              <Undo2 size={10} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  if (isToolOnlyMessage) {
    return (
      <>
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
      </>
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
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="-space-y-0">
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

          <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {isLastMessage &&
              (hasError(message.content) ? (
                <Tooltip content="Retry" side="top">
                  <button
                    onClick={handleRetryMessage}
                    className="rounded bg-secondary-bg p-1 transition-colors hover:bg-hover"
                    title="Retry"
                    aria-label="Retry failed message"
                  >
                    <RefreshCw size={12} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="Regenerate" side="top">
                  <button
                    onClick={handleRetryMessage}
                    className="rounded bg-secondary-bg p-1 transition-colors hover:bg-hover"
                    title="Regenerate"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw size={12} />
                  </button>
                </Tooltip>
              ))}
            <button
              onClick={() => handleCopyMessage(message.content, message.id)}
              className="rounded bg-secondary-bg p-1 transition-colors hover:bg-hover"
              title="Copy message"
              aria-label="Copy message"
            >
              {copiedMessageId === message.id ? (
                <Check size={12} className="text-green-400" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
});

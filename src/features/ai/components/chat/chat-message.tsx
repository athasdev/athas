import { Check, Copy, GitBranch, Layers3, RefreshCw, RotateCcw, Split, Undo2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import { createHarnessChatScopeId, createHarnessSessionKey } from "@/features/ai/lib/chat-scope";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { hasPlanBlock, parsePlan } from "@/features/ai/lib/plan-parser";
import type { AIChatSurface, ChatScopeId, Message } from "@/features/ai/types/ai-chat";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
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
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
}

function hasError(messageContent: string): boolean {
  return messageContent.includes("[ERROR_BLOCK]");
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastMessage,
  onApplyCode,
  surface = "panel",
  scopeId,
}: ChatMessageProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const { openAgentBuffer } = useBufferStore.use.actions();

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
      if (!chatState.currentChatId) return;

      const chat = chatActions.getCurrentChat();
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
      const chatIndex = chats.findIndex((c) => c.id === chatState.currentChatId);
      if (chatIndex !== -1) {
        useAIChatStore.setState((state) => {
          state.chats[chatIndex] = updatedChat;
        });
      }

      useAIChatStore.getState().syncChatToDatabase(chatState.currentChatId);
    },
    [chatActions, chatState.currentChatId],
  );

  const handleRetryMessage = useCallback(() => {
    const lastUserMessage = chatActions.regenerateResponse();
    if (lastUserMessage) {
      useAIChatStore.getState().addMessageToQueue(lastUserMessage, "follow-up", scopeId);
    }
  }, [chatActions, scopeId]);

  const handleForkCheckpoint = useCallback(
    async (messageId: string) => {
      if (!chatState.currentChatId) return;

      if (surface === "harness") {
        const nextSessionKey = createHarnessSessionKey();
        openAgentBuffer(nextSessionKey);
        await chatActions.forkChatFromChat(
          chatState.currentChatId,
          createHarnessChatScopeId(nextSessionKey),
          messageId,
        );
        return;
      }

      await chatActions.forkChatFromChat(chatState.currentChatId, scopeId, messageId);
    },
    [chatActions, chatState.currentChatId, openAgentBuffer, scopeId, surface],
  );

  const handleExecuteStep = useCallback(
    (step: PlanStep, stepIndex: number) => {
      const { setMode, addMessageToQueue } = useAIChatStore.getState();
      setMode("chat", scopeId);
      addMessageToQueue(
        `Execute step ${stepIndex + 1} of the plan: ${step.title}\n\n${step.description}`,
        "follow-up",
        scopeId,
      );
    },
    [scopeId],
  );

  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end py-2">
        <div className="group relative max-w-[85%] rounded-3xl bg-secondary-bg/80 px-4 py-3 shadow-sm">
          <div className="whitespace-pre-wrap break-words text-[14px] text-text leading-relaxed">
            {message.content}
          </div>
          <div className="-top-1 -right-4 absolute flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip content="Fork from this checkpoint" side="top">
              <button
                onClick={() => void handleForkCheckpoint(message.id)}
                className="flex items-center justify-center text-text-lighter/60 transition-colors hover:text-text"
                title="Fork from checkpoint"
                aria-label="Fork from this checkpoint"
              >
                <Split size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Trim this chat to this point" side="top">
              <button
                onClick={() => handleRestoreCheckpoint(message.id)}
                className="flex items-center justify-center text-text-lighter/60 transition-colors hover:text-text"
                title="Restore checkpoint"
                aria-label="Restore to this checkpoint"
              >
                <Undo2 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === "compaction-summary" || message.kind === "branch-summary") {
    const isCompaction = message.kind === "compaction-summary";
    const branchSummaryMeta = message.summaryMeta?.type === "branch" ? message.summaryMeta : null;

    return (
      <div className="my-2 border-border/20 border-y py-4 opacity-80">
        <div className="mb-2 flex items-center gap-2 text-[10px] text-text-lighter/60 uppercase tracking-[0.16em]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            {isCompaction ? <Layers3 size={12} /> : <GitBranch size={12} />}
            {isCompaction ? "Compaction Summary" : "Branch Summary"}
          </span>
          {message.summaryMeta?.type === "compaction" ? (
            <span className="opacity-80">
              · {message.summaryMeta.trigger} · {message.summaryMeta.tokensBefore}
            </span>
          ) : null}
          {branchSummaryMeta ? (
            <button
              onClick={() => {
                if (chatState.chats.some((chat) => chat.id === branchSummaryMeta.sourceChatId)) {
                  chatActions.switchToChat(branchSummaryMeta.sourceChatId);
                }
              }}
              className="opacity-80 transition-colors hover:text-text"
            >
              · {branchSummaryMeta.sourceChatTitle}
            </button>
          ) : null}
        </div>
        <MarkdownRenderer content={message.content} onApplyCode={onApplyCode} />
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
    if (isAcpAgent(chatActions.getCurrentAgentId())) {
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
        <div className="mb-1 space-y-1">
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

      {message.content && (
        <>
          <div className="pr-8 text-[14px] text-text leading-relaxed">
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

          <div className="absolute top-0 right-0 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {isLastMessage &&
              (hasError(message.content) ? (
                <Tooltip content="Retry" side="top">
                  <button
                    onClick={handleRetryMessage}
                    className="rounded-full border border-border/70 bg-primary-bg/90 p-1 transition-colors hover:bg-hover"
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
                    className="rounded-full border border-border/70 bg-primary-bg/90 p-1 transition-colors hover:bg-hover"
                    title="Regenerate"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw size={12} />
                  </button>
                </Tooltip>
              ))}
            <button
              onClick={() => handleCopyMessage(message.content, message.id)}
              className="rounded-full border border-border/70 bg-primary-bg/90 p-1 transition-colors hover:bg-hover"
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

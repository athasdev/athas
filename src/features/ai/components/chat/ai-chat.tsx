import { memo, useCallback, useEffect, useRef, useState } from "react";
import ApiKeyModal from "@/features/ai/components/api-key-modal";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "@/stores/toast-store";
import { AcpStreamHandler } from "@/utils/acp-handler";
import { getChatCompletionStream, isAcpAgent } from "@/utils/ai-chat";
import { hasKairoAccessToken } from "@/utils/kairo-auth";
import type { ContextInfo } from "@/utils/types";
import { useChatActions, useChatState } from "../../hooks/use-chat-store";
import ChatHistorySidebar from "../history/sidebar";
import AIChatInputBar from "../input/chat-input-bar";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";

function collapseExactRepeatedResponse(content: string): string {
  if (!content || content.length < 64) return content;

  const tryExact = (value: string): string => {
    for (const repeatCount of [3, 2]) {
      if (value.length % repeatCount !== 0) continue;
      const unitLength = value.length / repeatCount;
      if (unitLength < 24) continue;
      const unit = value.slice(0, unitLength);
      if (unit.repeat(repeatCount) === value) {
        return unit;
      }
    }
    return value;
  };

  const exact = tryExact(content);
  if (exact !== content) return exact;

  for (const separator of ["\n\n", "\r\n\r\n", "\n", "\r\n", " "]) {
    const parts = content.split(separator);
    if (parts.length === 2 && parts[0].length >= 24 && parts[0] === parts[1]) {
      return parts[0];
    }
  }

  return content;
}

const AIChat = memo(function AIChat({
  className,
  activeBuffer,
  buffers = [],
  selectedFiles = [],
  allProjectFiles = [],
  onApplyCode,
}: AIChatProps) {
  const { rootFolderPath } = useProjectStore();
  const { settings } = useSettingsStore();

  const chatState = useChatState();
  const chatActions = useChatActions();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeStreamRunIdRef = useRef<string | null>(null);
  const processMessageRef = useRef<(messageContent: string) => Promise<void>>(async () => {});
  const [permissionQueue, setPermissionQueue] = useState<
    Array<{ requestId: string; description: string; permissionType: string; resource: string }>
  >([]);

  useEffect(() => {
    if (activeBuffer) {
      chatActions.autoSelectBuffer(activeBuffer.id);
    }
  }, [activeBuffer, chatActions.autoSelectBuffer]);

  useEffect(() => {
    chatActions.checkApiKey(settings.aiProviderId);
    chatActions.checkAllProviderApiKeys();
  }, [settings.aiProviderId, chatActions.checkApiKey, chatActions.checkAllProviderApiKeys]);

  // Agent availability is now handled dynamically by the model-provider-selector component
  // No need to check Claude Code status on mount

  const handleDeleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    chatActions.deleteChat(chatId);
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const buildContext = async (): Promise<ContextInfo> => {
    const selectedBuffers = buffers.filter((buffer) => chatState.selectedBufferIds.has(buffer.id));

    // Build active buffer context, including web viewer content if applicable
    let activeBufferContext: (typeof activeBuffer & { webViewerContent?: string }) | undefined =
      activeBuffer || undefined;
    if (activeBuffer?.isWebViewer && activeBuffer.webViewerUrl) {
      // Fetch web page content for context
      const { fetchWebPageContent } = await import("@/utils/web-fetcher");
      const webContent = await fetchWebPageContent(activeBuffer.webViewerUrl);
      activeBufferContext = {
        ...activeBuffer,
        webViewerContent: webContent,
      };
    }

    const context: ContextInfo = {
      activeBuffer: activeBufferContext,
      openBuffers: selectedBuffers,
      selectedFiles,
      selectedProjectFiles: Array.from(chatState.selectedFilesPaths),
      projectRoot: rootFolderPath,
      providerId: settings.aiProviderId,
    };

    if (activeBuffer && !activeBuffer.isWebViewer) {
      const extension = activeBuffer.path.split(".").pop()?.toLowerCase() || "";
      const languageMap: Record<string, string> = {
        js: "JavaScript",
        jsx: "JavaScript (React)",
        ts: "TypeScript",
        tsx: "TypeScript (React)",
        py: "Python",
        rs: "Rust",
        go: "Go",
        java: "Java",
        cpp: "C++",
        c: "C",
        css: "CSS",
        html: "HTML",
        json: "JSON",
        md: "Markdown",
        sql: "SQL",
        sh: "Shell Script",
        yml: "YAML",
        yaml: "YAML",
      };

      context.language = languageMap[extension] || "Text";
    }

    return context;
  };

  const stopStreaming = async () => {
    // For ACP agents, send cancel notification
    const currentAgentId = chatActions.getCurrentAgentId();
    if (isAcpAgent(currentAgentId)) {
      try {
        await AcpStreamHandler.cancelPrompt();
        if (permissionQueue.length > 0) {
          await Promise.all(
            permissionQueue.map((item) =>
              AcpStreamHandler.respondToPermission(item.requestId, false, true),
            ),
          );
          setPermissionQueue([]);
        }
      } catch (error) {
        console.error("Failed to cancel ACP prompt:", error);
      }
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeStreamRunIdRef.current = null;
    chatActions.setIsTyping(false);
    chatActions.setStreamingMessageId(null);
  };

  const processMessage = async (messageContent: string) => {
    const currentAgentId = chatActions.getCurrentAgentId();
    if (currentAgentId === "kairo-code") {
      const isConnected = await hasKairoAccessToken();
      if (!isConnected) {
        toast.error(
          "Kairo Code requires Coline login first. Connect it in Settings > AI > Agent Authentication.",
        );
        return;
      }
    }

    const isAcp = isAcpAgent(currentAgentId);
    const requiresApiKey = !isAcp && currentAgentId !== "kairo-code";
    // ACP agents don't use API keys; Kairo Code uses OAuth
    if (!messageContent.trim() || (requiresApiKey && !chatState.hasApiKey)) return;

    // Agents are started automatically by AcpStreamHandler when needed

    let chatId = chatState.currentChatId;
    if (!chatId) {
      chatId = chatActions.ensureChatForAgent(chatActions.getCurrentAgentId());
    }

    const { processedMessage } = await parseMentionsAndLoadFiles(
      messageContent.trim(),
      allProjectFiles,
    );

    const context = await buildContext();
    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageContent.trim(),
      role: "user",
      timestamp: new Date(),
    };

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: "",
      role: "assistant",
      timestamp: new Date(),
      isStreaming: true,
    };

    chatActions.addMessage(chatId, userMessage);
    chatActions.addMessage(chatId, assistantMessage);

    const currentMessages = chatActions.getCurrentMessages();
    if (currentMessages.length === 2) {
      const title =
        userMessage.content.length > 50
          ? `${userMessage.content.substring(0, 50)}...`
          : userMessage.content;
      chatActions.updateChatTitle(chatId, title);
    }

    chatActions.setIsTyping(true);
    chatActions.setStreamingMessageId(assistantMessageId);

    requestAnimationFrame(scrollToBottom);

    abortControllerRef.current = new AbortController();
    const streamRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeStreamRunIdRef.current = streamRunId;

    try {
      const conversationContext = currentMessages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

      const enhancedMessage = processedMessage;
      let currentAssistantMessageId = assistantMessageId;
      const currentAgentId = chatActions.getCurrentAgentId();

      await getChatCompletionStream(
        currentAgentId,
        settings.aiProviderId,
        settings.aiModelId,
        enhancedMessage,
        context,
        (chunk: string) => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            content: (currentMsg?.content || "") + chunk,
          });
          requestAnimationFrame(scrollToBottom);
        },
        () => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          activeStreamRunIdRef.current = null;
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          const nextContent =
            isAcpAgent(currentAgentId) && currentMsg?.content
              ? collapseExactRepeatedResponse(currentMsg.content)
              : currentMsg?.content;
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            ...(typeof nextContent === "string" ? { content: nextContent } : {}),
            isStreaming: false,
          });
          chatActions.setIsTyping(false);
          chatActions.setStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
        },
        (error: string) => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          activeStreamRunIdRef.current = null;
          console.error("Streaming error:", error);

          let errorTitle = "API Error";
          let errorMessage = error;
          let errorCode = "";
          let errorDetails = "";

          const parts = error.split("|||");
          const mainError = parts[0];
          if (parts.length > 1) {
            errorDetails = parts.slice(1).join("|||");
          }

          if (mainError.toLowerCase().includes("workspace_unavailable")) {
            errorTitle = "Workspace Bridge Required";
            errorCode = "workspace_unavailable";
            errorMessage =
              errorDetails ||
              "No workspace binding is available for this chat session. Connect the Athas workspace bridge and retry.";
          } else if (
            mainError.toLowerCase().includes("kairo acp bridge error: stream") &&
            errorDetails.toLowerCase().includes("workspace_unavailable")
          ) {
            const [, workspaceMessage = ""] = errorDetails.split("|||");
            errorTitle = "Workspace Bridge Required";
            errorCode = "workspace_unavailable";
            errorMessage =
              workspaceMessage ||
              "No workspace binding is available for this chat session. Connect the Athas workspace bridge and retry.";
          }

          const codeMatch = mainError.match(/error:\s*(\d+)/i);
          if (codeMatch && !errorCode) {
            errorCode = codeMatch[1];
            if (errorCode === "429") {
              errorTitle = "Rate Limit Exceeded";
              errorMessage =
                "The API is temporarily rate-limited. Please wait a moment and try again.";
            } else if (errorCode === "401") {
              errorTitle = "Authentication Error";
              errorMessage = "Invalid API key. Please check your API settings.";
            } else if (errorCode === "403") {
              errorTitle = "Access Denied";
              errorMessage = "You don't have permission to access this resource.";
            } else if (errorCode === "500") {
              errorTitle = "Server Error";
              errorMessage = "The API server encountered an error. Please try again later.";
            } else if (errorCode === "400") {
              errorTitle = "Bad Request";
              if (errorDetails) {
                try {
                  const parsed = JSON.parse(errorDetails);
                  if (parsed.error?.message) {
                    errorMessage = parsed.error.message;
                  }
                } catch {
                  errorMessage = mainError;
                }
              }
            }
          }

          const formattedError = `[ERROR_BLOCK]
title: ${errorTitle}
code: ${errorCode}
message: ${errorMessage}
details: ${errorDetails || mainError}
[/ERROR_BLOCK]`;

          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            content: currentMsg?.content || formattedError,
            isStreaming: false,
          });
          chatActions.setIsTyping(false);
          chatActions.setStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
        },
        conversationContext,
        () => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          const newMessageId = Date.now().toString();
          const newAssistantMessage: Message = {
            id: newMessageId,
            content: "",
            role: "assistant",
            timestamp: new Date(),
            isStreaming: true,
          };

          chatActions.addMessage(chatId, newAssistantMessage);
          currentAssistantMessageId = newMessageId;
          chatActions.setStreamingMessageId(newMessageId);
          requestAnimationFrame(scrollToBottom);
        },
        (toolName: string, toolInput?: any, toolId?: string, event?: any) => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          const existing = currentMsg?.toolCalls || [];
          const nextToolCalls = toolId
            ? existing.map((tc) =>
                tc.toolId === toolId
                  ? {
                      ...tc,
                      name: toolName,
                      input: toolInput,
                      kind: event?.kind,
                      status: event?.status,
                      content: event?.content,
                      locations: event?.locations,
                    }
                  : tc,
              )
            : existing;

          const hasExistingById = Boolean(toolId && existing.some((tc) => tc.toolId === toolId));
          const appended = hasExistingById
            ? nextToolCalls
            : [
                ...nextToolCalls,
                {
                  toolId,
                  name: toolName,
                  input: toolInput,
                  kind: event?.kind,
                  status: event?.status,
                  content: event?.content,
                  locations: event?.locations,
                  timestamp: new Date(),
                },
              ];

          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            isToolUse: true,
            toolName,
            toolCalls: appended,
          });
        },
        (toolName: string, event?: any) => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);

          const normalizeTool = (value: string) => value.trim().toLowerCase();
          const isReadTool = (value: string) => {
            const normalized = normalizeTool(value);
            return (
              normalized === "read" ||
              normalized === "read_file" ||
              normalized === "readfile" ||
              normalized.includes("read")
            );
          };

          // Find the tool call that just completed
          const completedToolCall = currentMsg?.toolCalls?.find(
            (tc) =>
              (event?.toolId
                ? tc.toolId === event.toolId
                : normalizeTool(tc.name) === normalizeTool(toolName)) && !tc.isComplete,
          );

          // Auto-open Read files if setting is enabled
          const readPath =
            completedToolCall?.input?.file_path || completedToolCall?.input?.path || undefined;
          if (isReadTool(toolName) && readPath) {
            const { settings } = useSettingsStore.getState();
            if (settings.aiAutoOpenReadFiles) {
              const { handleFileSelect } = useFileSystemStore.getState();
              handleFileSelect(readPath, false);
            }
          }

          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            toolCalls: currentMsg?.toolCalls?.map((tc) =>
              (event?.toolId
                ? tc.toolId === event.toolId
                : normalizeTool(tc.name) === normalizeTool(toolName)) && !tc.isComplete
                ? {
                    ...tc,
                    isComplete: true,
                    status: event?.status || (event?.success === false ? "failed" : "completed"),
                    output: event?.output ?? tc.output,
                    error: event?.error ?? tc.error,
                    input: event?.input ?? tc.input,
                    kind: event?.kind ?? tc.kind,
                    content: event?.content ?? tc.content,
                    locations: event?.locations ?? tc.locations,
                  }
                : tc,
            ),
          });
        },
        (event) => {
          if (activeStreamRunIdRef.current !== streamRunId) return;
          setPermissionQueue((prev) => [
            ...prev,
            {
              requestId: event.requestId,
              description: event.description,
              permissionType: event.permissionType,
              resource: event.resource,
            },
          ]);
        },
        undefined,
        chatState.mode,
        chatState.outputStyle,
        chatId,
        abortControllerRef.current?.signal,
      );
    } catch (error) {
      if (activeStreamRunIdRef.current === streamRunId) {
        activeStreamRunIdRef.current = null;
      }
      console.error("Failed to start streaming:", error);
      chatActions.updateMessage(chatId, assistantMessageId, {
        content: "Error: Failed to connect to AI service. Please check your API key and try again.",
        isStreaming: false,
      });
      chatActions.setIsTyping(false);
      chatActions.setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  };
  processMessageRef.current = processMessage;

  const processQueuedMessages = useCallback(async () => {
    if (chatState.isTyping || chatState.streamingMessageId) {
      return;
    }

    const nextMessage = chatActions.processNextMessage();
    if (nextMessage) {
      console.log("Processing next queued message:", nextMessage.content);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await processMessageRef.current(nextMessage.content);
    }
  }, [chatState.isTyping, chatState.streamingMessageId, chatActions.processNextMessage]);

  const sendMessage = useCallback(
    async (messageContent: string) => {
      const currentAgentId = chatActions.getCurrentAgentId();
      if (currentAgentId === "kairo-code") {
        const isConnected = await hasKairoAccessToken();
        if (!isConnected) {
          toast.error(
            "Kairo Code requires Coline login first. Connect it in Settings > AI > Agent Authentication.",
          );
          return;
        }
      }

      const isAcp = isAcpAgent(currentAgentId);
      const requiresApiKey = !isAcp && currentAgentId !== "kairo-code";
      if (!messageContent.trim() || (requiresApiKey && !chatState.hasApiKey)) return;

      chatActions.setInput("");

      if (chatState.isTyping || chatState.streamingMessageId) {
        chatActions.addMessageToQueue(messageContent);
        return;
      }

      await processMessageRef.current(messageContent);
    },
    [
      chatState.hasApiKey,
      chatState.isTyping,
      chatState.streamingMessageId,
      chatActions.setInput,
      chatActions.addMessageToQueue,
      chatActions.getCurrentAgentId,
    ],
  );

  const handleSendMessage = useCallback(
    async (messageContent: string) => {
      await sendMessage(messageContent);
    },
    [sendMessage],
  );

  const currentPermission = permissionQueue[0];
  const handlePermission = async (approved: boolean) => {
    if (!currentPermission) return;
    try {
      await AcpStreamHandler.respondToPermission(currentPermission.requestId, approved);
    } finally {
      setPermissionQueue((prev) => prev.slice(1));
    }
  };

  return (
    <div
      className={`ui-font flex h-full flex-col bg-secondary-bg text-text text-xs ${className || ""}`}
    >
      <ChatHeader />

      <div className="scrollbar-hidden flex-1 overflow-y-auto">
        <ChatMessages ref={messagesEndRef} onApplyCode={onApplyCode} />
      </div>

      {currentPermission && (
        <div className="border-border border-t bg-secondary-bg px-3 py-2 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-text-lighter">permission:</span>
            <span
              className="min-w-0 flex-1 truncate text-text"
              title={`${currentPermission.permissionType} • ${currentPermission.resource}`}
            >
              {currentPermission.description}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => handlePermission(false)}
                className="rounded border border-border bg-primary-bg px-2 py-1 text-text-lighter hover:bg-hover"
              >
                deny
              </button>
              <button
                type="button"
                onClick={() => handlePermission(true)}
                className="rounded border border-border bg-primary-bg px-2 py-1 text-text hover:bg-hover"
              >
                allow
              </button>
            </div>
          </div>
        </div>
      )}

      <AIChatInputBar
        buffers={buffers}
        allProjectFiles={allProjectFiles}
        onSendMessage={handleSendMessage}
        onStopStreaming={stopStreaming}
      />

      <ApiKeyModal
        isOpen={chatState.apiKeyModalState.isOpen}
        onClose={() => chatActions.setApiKeyModalState({ isOpen: false, providerId: null })}
        providerId={chatState.apiKeyModalState.providerId || ""}
        onSave={chatActions.saveApiKey}
        onRemove={chatActions.removeApiKey}
        hasExistingKey={
          chatState.apiKeyModalState.providerId
            ? chatActions.hasProviderApiKey(chatState.apiKeyModalState.providerId)
            : false
        }
      />

      <ChatHistorySidebar
        chats={chatState.chats}
        currentChatId={chatState.currentChatId}
        onSwitchToChat={chatActions.switchToChat}
        onDeleteChat={handleDeleteChat}
        isOpen={chatState.isChatHistoryVisible}
        onClose={() => chatActions.setIsChatHistoryVisible(false)}
      />
    </div>
  );
});

export default AIChat;

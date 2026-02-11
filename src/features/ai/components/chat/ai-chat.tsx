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
  const [permissionQueue, setPermissionQueue] = useState<
    Array<{ requestId: string; description: string; permissionType: string; resource: string }>
  >([]);
  const [acpEvents, setAcpEvents] = useState<Array<{ id: string; text: string }>>([]);

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
      if (isAcp) {
        setAcpEvents([]);
      }

      await getChatCompletionStream(
        currentAgentId,
        settings.aiProviderId,
        settings.aiModelId,
        enhancedMessage,
        context,
        (chunk: string) => {
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            content: (currentMsg?.content || "") + chunk,
          });
          requestAnimationFrame(scrollToBottom);
        },
        () => {
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            isStreaming: false,
          });
          chatActions.setIsTyping(false);
          chatActions.setStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
        },
        (error: string) => {
          console.error("Streaming error:", error);

          let errorTitle = "API Error";
          let errorMessage = error;
          let errorCode = "";
          let errorDetails = "";

          const parts = error.split("|||");
          const mainError = parts[0];
          if (parts.length > 1) {
            errorDetails = parts[1];
          }

          const codeMatch = mainError.match(/error:\s*(\d+)/i);
          if (codeMatch) {
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
        (toolName: string, toolInput?: any) => {
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            isToolUse: true,
            toolName,
            toolCalls: [
              ...(currentMsg?.toolCalls || []),
              {
                name: toolName,
                input: toolInput,
                timestamp: new Date(),
              },
            ],
          });
        },
        (toolName: string) => {
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);

          // Find the tool call that just completed
          const completedToolCall = currentMsg?.toolCalls?.find(
            (tc) => tc.name === toolName && !tc.isComplete,
          );

          // Auto-open Read files if setting is enabled
          if (toolName === "Read" && completedToolCall?.input?.file_path) {
            const { settings } = useSettingsStore.getState();
            if (settings.aiAutoOpenReadFiles) {
              const { handleFileSelect } = useFileSystemStore.getState();
              handleFileSelect(completedToolCall.input.file_path, false);
            }
          }

          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            toolCalls: currentMsg?.toolCalls?.map((tc) =>
              tc.name === toolName && !tc.isComplete ? { ...tc, isComplete: true } : tc,
            ),
          });
        },
        (event) => {
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
        (event) => {
          if (!isAcpAgent(currentAgentId)) return;
          const format = () => {
            switch (event.type) {
              case "tool_start":
                return `tool_start ${event.toolName}`;
              case "tool_complete":
                return `tool_complete ${event.toolId}`;
              case "permission_request":
                return `permission ${event.permissionType}: ${event.description}`;
              case "prompt_complete":
                return `prompt_complete ${event.stopReason}`;
              case "session_mode_update":
                return `mode_state ${event.modeState.currentModeId ?? "none"}`;
              case "current_mode_update":
                return `mode ${event.currentModeId}`;
              case "slash_commands_update":
                return `slash_commands ${event.commands.length}`;
              case "status_changed":
                return `status running=${event.status.running}`;
              case "error":
                return `error ${event.error}`;
              case "session_complete":
                return "session_complete";
              case "content_chunk":
                return "content_chunk";
            }
          };
          setAcpEvents((prev) => [
            ...prev.slice(-199),
            { id: `${Date.now()}-${event.type}`, text: format() },
          ]);
        },
        chatState.mode,
        chatState.outputStyle,
      );
    } catch (error) {
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

  const processQueuedMessages = useCallback(async () => {
    if (chatState.isTyping || chatState.streamingMessageId) {
      return;
    }

    const nextMessage = chatActions.processNextMessage();
    if (nextMessage) {
      console.log("Processing next queued message:", nextMessage.content);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await processMessage(nextMessage.content);
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

      await processMessage(messageContent);
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
      setAcpEvents((prev) => [
        ...prev.slice(-199),
        {
          id: `${Date.now()}-permission-response`,
          text: `permission_response ${approved ? "allow" : "deny"}`,
        },
      ]);
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
        <ChatMessages ref={messagesEndRef} onApplyCode={onApplyCode} acpEvents={acpEvents} />
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

import { memo, useCallback, useEffect, useRef, useState } from "react";
import ApiKeyModal from "@/features/ai/components/api-key-modal";
import {
  appendChatAcpEvent,
  type ChatAcpEventInput,
  truncateDetail,
  updateToolCompletionAcpEvent,
} from "@/features/ai/lib/acp-event-timeline";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import { createToolCall, markToolCallComplete } from "@/features/ai/lib/tool-call-state";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import { useProjectStore } from "@/stores/project-store";
import { AcpStreamHandler } from "@/utils/acp-handler";
import { getChatCompletionStream, isAcpAgent } from "@/utils/ai-chat";
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
  const subscription = useAuthStore((state) => state.subscription);
  const enterprisePolicy = subscription?.enterprise?.policy;
  const isAiChatBlockedByPolicy = Boolean(
    enterprisePolicy?.managedMode && !enterprisePolicy.aiChatEnabled,
  );

  const chatState = useChatState();
  const chatActions = useChatActions();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [permissionQueue, setPermissionQueue] = useState<
    Array<{ requestId: string; description: string; permissionType: string; resource: string }>
  >([]);
  const [acpEvents, setAcpEvents] = useState<ChatAcpEvent[]>([]);
  const activeToolEventIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (activeBuffer) {
      chatActions.autoSelectBuffer(activeBuffer.id);
    }
  }, [activeBuffer, chatActions.autoSelectBuffer]);

  useEffect(() => {
    chatActions.checkApiKey(settings.aiProviderId);
    chatActions.checkAllProviderApiKeys();
  }, [settings.aiProviderId, chatActions.checkApiKey, chatActions.checkAllProviderApiKeys]);

  // Clear ACP events when switching chats
  useEffect(() => {
    setAcpEvents([]);
    activeToolEventIdsRef.current.clear();
  }, [chatState.currentChatId]);

  const appendAcpEvent = useCallback((event: ChatAcpEventInput) => {
    setAcpEvents((prev) => appendChatAcpEvent(prev, event));
  }, []);

  // Agent availability is now handled dynamically by the model-provider-selector component
  // No need to check Claude Code status on mount

  const handleDeleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    chatActions.deleteChat(chatId);
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const buildContext = async (agentId: string): Promise<ContextInfo> => {
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
      agentId,
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
    activeToolEventIdsRef.current.clear();
    chatActions.setIsTyping(false);
    chatActions.setStreamingMessageId(null);
  };

  const updateStreamingAssistantMessage = useCallback(
    (
      chatId: string,
      messageId: string,
      mutate: (currentMessage: Message | undefined) => Partial<Message>,
    ) => {
      const currentMessages = chatActions.getCurrentMessages();
      const currentMessage = currentMessages.find((message) => message.id === messageId);
      chatActions.updateMessage(chatId, messageId, mutate(currentMessage));
    },
    [chatActions.getCurrentMessages, chatActions.updateMessage],
  );

  const processMessage = async (messageContent: string) => {
    const currentAgentId = chatActions.getCurrentAgentId();
    const isAcp = isAcpAgent(currentAgentId);
    // For ACP agents (Claude Code, etc.), we don't need an API key
    // For Custom API, we need an API key to be set
    if (!messageContent.trim() || (!isAcp && !chatState.hasApiKey)) return;

    // Agents are started automatically by AcpStreamHandler when needed

    let chatId = chatState.currentChatId;
    if (!chatId) {
      chatId = chatActions.ensureChatForAgent(chatActions.getCurrentAgentId());
    }

    const { processedMessage } = await parseMentionsAndLoadFiles(
      messageContent.trim(),
      allProjectFiles,
    );

    const context = await buildContext(currentAgentId);
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
    let currentAssistantMessageId = assistantMessageId;

    try {
      // Handle direct ACP UI intents locally so they are always reliable.
      if (isAcp) {
        const directAction = parseDirectAcpUiAction(messageContent);
        if (directAction) {
          const bufferActions = useBufferStore.getState().actions;
          if (directAction.kind === "open_web_viewer" && directAction.url) {
            bufferActions.openWebViewerBuffer(directAction.url);
            chatActions.updateMessage(chatId, currentAssistantMessageId, {
              content: `Opened ${directAction.url} in Athas web viewer.`,
              isStreaming: false,
            });
          } else if (directAction.kind === "open_terminal" && directAction.command) {
            bufferActions.openTerminalBuffer({
              command: directAction.command,
              name: directAction.command,
            });
            chatActions.updateMessage(chatId, currentAssistantMessageId, {
              content: `Opened terminal and ran \`${directAction.command}\`.`,
              isStreaming: false,
            });
          }

          chatActions.setIsTyping(false);
          chatActions.setStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
          return;
        }
      }

      const conversationContext = currentMessages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

      const enhancedMessage = processedMessage;
      if (isAcp) {
        setAcpEvents([]);
        activeToolEventIdsRef.current.clear();
      }

      await getChatCompletionStream(
        currentAgentId,
        settings.aiProviderId,
        settings.aiModelId,
        enhancedMessage,
        context,
        (chunk: string) => {
          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            content: (currentMessage?.content || "") + chunk,
          }));
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
        (error: string, canReconnect?: boolean) => {
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

          if (canReconnect) {
            errorTitle = "Connection Lost";
            errorCode = "RECONNECT";
          }

          const formattedError = `[ERROR_BLOCK]
title: ${errorTitle}
code: ${errorCode}
message: ${errorMessage}
details: ${errorDetails || mainError}
[/ERROR_BLOCK]`;

          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            content: currentMessage?.content || formattedError,
            isStreaming: false,
          }));
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
        (toolName: string, toolInput?: any, toolId?: string) => {
          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            isToolUse: true,
            toolName,
            toolCalls: [
              ...(currentMessage?.toolCalls || []),
              createToolCall(toolName, toolInput, toolId),
            ],
          }));
        },
        (toolName: string, toolId?: string) => {
          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            toolCalls: markToolCallComplete(currentMessage?.toolCalls || [], toolName, toolId),
          }));
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
          // Only show meaningful events, skip noisy ones
          if (
            event.type === "content_chunk" ||
            event.type === "user_message_chunk" ||
            event.type === "session_complete"
          ) {
            return;
          }
          switch (event.type) {
            case "thought_chunk": {
              appendAcpEvent({
                kind: "thinking",
                label: "Thinking",
                state: "running",
              });
              break;
            }
            case "tool_start": {
              const activityId = `tool-${event.toolId}`;
              activeToolEventIdsRef.current.set(event.toolId, activityId);
              appendAcpEvent({
                id: activityId,
                kind: "tool",
                label: event.toolName,
                detail: "running",
                state: "running",
              });
              break;
            }
            case "tool_complete": {
              const activityId =
                activeToolEventIdsRef.current.get(event.toolId) ?? `tool-${event.toolId}`;
              setAcpEvents((prev) => updateToolCompletionAcpEvent(prev, activityId, event.success));
              activeToolEventIdsRef.current.delete(event.toolId);
              break;
            }
            case "permission_request":
              break; // Handled separately with permission UI
            case "prompt_complete":
              break; // Not useful to show
            case "session_mode_update":
              if (event.modeState.currentModeId) {
                appendAcpEvent({
                  kind: "mode",
                  label: "Mode changed",
                  detail: event.modeState.currentModeId,
                  state: "info",
                });
              }
              break;
            case "current_mode_update":
              appendAcpEvent({
                kind: "mode",
                label: "Mode changed",
                detail: event.currentModeId,
                state: "info",
              });
              break;
            case "slash_commands_update":
              break; // Not useful to show
            case "plan_update": {
              const summary =
                event.entries.length > 0
                  ? event.entries
                      .slice(0, 2)
                      .map((entry) => entry.content)
                      .join(" | ")
                  : "No plan steps";
              appendAcpEvent({
                kind: "plan",
                label: `Plan updated (${event.entries.length} steps)`,
                detail: truncateDetail(summary),
                state: "info",
              });
              break;
            }
            case "status_changed":
              break; // internal state sync
            case "error":
              appendAcpEvent({
                kind: "error",
                label: "Agent error",
                detail: truncateDetail(event.error),
                state: "error",
              });
              break;
            case "ui_action":
              break; // Handled by acp-handler
          }
        },
        chatState.mode,
        chatState.outputStyle,
        (data: string, mediaType: string) => {
          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            images: [...(currentMessage?.images || []), { data, mediaType }],
          }));
          requestAnimationFrame(scrollToBottom);
        },
        (uri: string, name: string | null) => {
          updateStreamingAssistantMessage(chatId, currentAssistantMessageId, (currentMessage) => ({
            resources: [...(currentMessage?.resources || []), { uri, name }],
          }));
          requestAnimationFrame(scrollToBottom);
        },
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
      const isAcp = isAcpAgent(currentAgentId);
      // For ACP agents (Claude Code, etc.), we don't need an API key
      if (!messageContent.trim() || (!isAcp && !chatState.hasApiKey)) return;

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
      appendAcpEvent({
        kind: "permission",
        label: "Permission response",
        detail: approved ? "allow" : "deny",
        state: approved ? "success" : "info",
      });
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
      {isAiChatBlockedByPolicy ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-border bg-secondary-bg/40 p-4 text-center">
            <p className="font-medium text-sm text-text">AI chat is disabled</p>
            <p className="mt-2 text-text-lighter text-xs">
              Your organization policy has disabled AI chat for this workspace.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="scrollbar-hidden relative z-0 flex-1 overflow-y-auto">
            <ChatMessages ref={messagesEndRef} onApplyCode={onApplyCode} acpEvents={acpEvents} />
          </div>

          {currentPermission && (
            <div className="bg-transparent px-3 pt-2 text-xs">
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-primary-bg/90 px-3 py-2 font-mono">
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
                    className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text-lighter hover:bg-hover"
                  >
                    deny
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePermission(true)}
                    className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text hover:bg-hover"
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
        </>
      )}
    </div>
  );
});

export default AIChat;

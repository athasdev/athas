import { memo, useCallback, useEffect, useRef, useState } from "react";
import ApiKeyModal from "@/features/ai/components/api-key-modal";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
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

interface DirectAcpUiAction {
  kind: "open_web_viewer" | "open_terminal";
  url?: string;
  command?: string;
}

const stripWrappingChars = (value: string): string =>
  value
    .trim()
    .replace(/^[`"'([{<\s]+/, "")
    .replace(/[`"')\]}>.,!?;:\s]+$/, "")
    .trim();

const normalizeWebUrl = (input: string): string | null => {
  const cleaned = stripWrappingChars(input);
  if (!cleaned) return null;

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      return new URL(cleaned).toString();
    } catch {
      return null;
    }
  }

  const hostLike = cleaned
    .replace(/^www\./i, "www.")
    .match(/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i);
  if (!hostLike) return null;

  try {
    return new URL(`https://${cleaned}`).toString();
  } catch {
    return null;
  }
};

const parseDirectAcpUiAction = (message: string): DirectAcpUiAction | null => {
  const text = message.trim();
  if (!text) return null;

  // Examples: "open linear.app on web", "open https://x.com in browser"
  const webMatch = text.match(/\bopen\s+(.+?)\s+(?:on|in)\s+(?:web|browser|site)\b/i);
  if (webMatch?.[1]) {
    const url = normalizeWebUrl(webMatch[1]);
    if (url) return { kind: "open_web_viewer", url };
  }

  // Examples: "open lazygit on terminal", "open npm run dev in terminal"
  const terminalMatch = text.match(/\bopen\s+(.+?)\s+(?:on|in)\s+terminal\b/i);
  if (terminalMatch?.[1]) {
    const command = stripWrappingChars(terminalMatch[1]);
    if (command) return { kind: "open_terminal", command };
  }

  return null;
};

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

  // Clear ACP events when switching chats
  useEffect(() => {
    setAcpEvents([]);
  }, [chatState.currentChatId]);

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
    chatActions.setIsTyping(false);
    chatActions.setStreamingMessageId(null);
  };

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
          // Only show meaningful events, skip noisy ones
          if (event.type === "content_chunk" || event.type === "session_complete") {
            return;
          }
          const format = (): string | null => {
            switch (event.type) {
              case "tool_start":
                return event.toolName;
              case "tool_complete":
                return null; // Skip, tool_start already shown
              case "permission_request":
                return null; // Handled separately with permission UI
              case "prompt_complete":
                return null; // Not useful to show
              case "session_mode_update":
                return event.modeState.currentModeId
                  ? `Mode: ${event.modeState.currentModeId}`
                  : null;
              case "current_mode_update":
                return `Mode: ${event.currentModeId}`;
              case "slash_commands_update":
                return null; // Not useful to show
              case "status_changed":
                return null; // Not useful to show
              case "error":
                return `Error: ${event.error}`;
              case "ui_action":
                return null; // Handled by acp-handler
            }
          };
          const text = format();
          if (text) {
            setAcpEvents((prev) => [
              ...prev.slice(-19),
              { id: `${Date.now()}-${event.type}`, text },
            ]);
          }
        },
        chatState.mode,
        chatState.outputStyle,
        (data: string, mediaType: string) => {
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            images: [...(currentMsg?.images || []), { data, mediaType }],
          });
          requestAnimationFrame(scrollToBottom);
        },
        (uri: string, name: string | null) => {
          const currentMessages = chatActions.getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            resources: [...(currentMsg?.resources || []), { uri, name }],
          });
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

      if (currentAgentId === "kairo-code") {
        const isConnected = await hasKairoAccessToken();
        if (!isConnected) {
          toast.error(
            "Kairo Code requires Coline login first. Connect it in Settings > AI > Agent Authentication.",
          );
          return;
        }
      }

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

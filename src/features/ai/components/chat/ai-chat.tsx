import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useRef } from "react";
import ApiKeyModal from "@/features/ai/components/api-key-modal";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat";
import type { ClaudeStatus } from "@/features/ai/types/claude";
import { getAvailableProviders, setClaudeCodeAvailability } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/stores/project-store";
import { getChatCompletionStream } from "@/utils/ai-chat";
import type { ContextInfo } from "@/utils/types";
import { useChatActions, useChatState } from "../../hooks/use-chat-store";
import { useAIChatStore } from "../../store/store";
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
  const { settings, updateSetting } = useSettingsStore();

  const chatState = useChatState();
  const chatActions = useChatActions();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (activeBuffer) {
      chatActions.autoSelectBuffer(activeBuffer.id);
    }
  }, [activeBuffer, chatActions.autoSelectBuffer]);

  useEffect(() => {
    chatActions.checkApiKey(settings.aiProviderId);
    chatActions.checkAllProviderApiKeys();
  }, [settings.aiProviderId, chatActions.checkApiKey, chatActions.checkAllProviderApiKeys]);

  useEffect(() => {
    const checkClaudeCodeStatus = async () => {
      try {
        const status = await invoke<ClaudeStatus>("get_claude_status");
        setClaudeCodeAvailability(status.interceptor_running);

        if (settings.aiProviderId === "claude-code" && !status.interceptor_running) {
          const availableProviders = getAvailableProviders();
          if (availableProviders.length > 0) {
            const firstProvider = availableProviders[0];
            updateSetting("aiProviderId", firstProvider.id);
            updateSetting("aiModelId", firstProvider.models[0].id);
          }
        }
      } catch {
        setClaudeCodeAvailability(false);
        if (settings.aiProviderId === "claude-code") {
          const availableProviders = getAvailableProviders();
          if (availableProviders.length > 0) {
            const firstProvider = availableProviders[0];
            updateSetting("aiProviderId", firstProvider.id);
            updateSetting("aiModelId", firstProvider.models[0].id);
          }
        }
      }
    };
    checkClaudeCodeStatus();
  }, [settings.aiProviderId, updateSetting]);

  const handleDeleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    chatActions.deleteChat(chatId);
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const buildContext = (): ContextInfo => {
    const selectedBuffers = buffers.filter((buffer) => chatState.selectedBufferIds.has(buffer.id));
    const context: ContextInfo = {
      activeBuffer: activeBuffer || undefined,
      openBuffers: selectedBuffers,
      selectedFiles,
      selectedProjectFiles: Array.from(chatState.selectedFilesPaths),
      projectRoot: rootFolderPath,
      providerId: settings.aiProviderId,
    };

    if (activeBuffer) {
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

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    chatActions.setIsTyping(false);
    chatActions.setStreamingMessageId(null);
  };

  const processMessage = async (messageContent: string) => {
    if (!messageContent.trim() || !chatState.hasApiKey) return;

    if (settings.aiProviderId === "claude-code") {
      try {
        const status = await invoke<ClaudeStatus>("get_claude_status");
        if (!status.running) {
          await invoke("start_claude_code", {
            workspacePath: rootFolderPath || null,
          });
        }
      } catch (error) {
        const errorMsg = String(error);
        if (!errorMsg.includes("already running")) {
          console.error("Failed to start claude-code:", error);
        }
      }
    }

    let chatId = chatState.currentChatId;
    if (!chatId) {
      chatId = chatActions.createNewChat();
    }

    const { processedMessage } = await parseMentionsAndLoadFiles(
      messageContent.trim(),
      allProjectFiles,
    );

    const context = buildContext();
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

      await getChatCompletionStream(
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
          chatActions.updateMessage(chatId, currentAssistantMessageId, {
            toolCalls: currentMsg?.toolCalls?.map((tc) =>
              tc.name === toolName && !tc.isComplete ? { ...tc, isComplete: true } : tc,
            ),
          });
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
      if (!messageContent.trim() || !chatState.hasApiKey) return;

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
    ],
  );

  const handleSendMessage = useCallback(async () => {
    const currentInput = useAIChatStore.getState().input;
    await sendMessage(currentInput);
  }, [sendMessage]);

  return (
    <div
      className={`ui-font flex h-full flex-col bg-secondary-bg text-text text-xs ${className || ""}`}
    >
      <ChatHeader />

      <div className="scrollbar-hidden flex-1 overflow-y-auto">
        <ChatMessages ref={messagesEndRef} onApplyCode={onApplyCode} />
      </div>

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

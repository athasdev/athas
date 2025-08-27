import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, MessageSquare, Plus, Sparkles } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/settings/store";
import { useAIChatStore } from "@/stores/ai-chat/store";
import { useProjectStore } from "@/stores/project-store";
import {
  getAvailableProviders,
  getProviderById,
  setClaudeCodeAvailability,
} from "@/types/ai-provider";
import type { ClaudeStatus } from "@/types/claude";
import { getChatCompletionStream } from "@/utils/ai-chat";
import { cn } from "@/utils/cn";
import type { ContextInfo } from "@/utils/types";
import ApiKeyModal from "../api-key-modal";
import AIChatInputBar from "./ai-chat-input-bar";
import ChatHistoryModal from "./chat-history-modal";
import MarkdownRenderer from "./markdown-renderer";
import { parseMentionsAndLoadFiles } from "./mention-utils";
import ToolCallDisplay from "./tool-call-display";
import type { AIChatProps, Message } from "./types";
import { formatTime } from "./utils";

// Editable Chat Title Component
function EditableChatTitle({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update editValue when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== title) {
      onUpdateTitle(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="rounded border-none bg-transparent px-1 py-0.5 font-medium text-text outline-none focus:bg-hover"
        style={{ minWidth: "100px", maxWidth: "200px" }}
      />
    );
  }

  return (
    <span
      className="cursor-pointer rounded px-1 py-0.5 font-medium transition-colors hover:bg-hover"
      onClick={() => setIsEditing(true)}
      title="Click to rename chat"
    >
      {title}
    </span>
  );
}

const AIChat = memo(function AIChat({
  className,
  activeBuffer,
  buffers = [],
  selectedFiles = [],
  allProjectFiles = [],
  mode: _,
  onApplyCode,
}: AIChatProps) {
  // Get rootFolderPath from project store
  const { rootFolderPath } = useProjectStore();

  const { settings, updateSetting } = useSettingsStore();

  // Get store state selectively to avoid re-renders - using individual selectors
  const input = useAIChatStore((state) => state.input);
  const selectedBufferIds = useAIChatStore((state) => state.selectedBufferIds);
  const selectedFilesPaths = useAIChatStore((state) => state.selectedFilesPaths);
  const hasApiKey = useAIChatStore((state) => state.hasApiKey);
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const isChatHistoryVisible = useAIChatStore((state) => state.isChatHistoryVisible);
  const apiKeyModalState = useAIChatStore((state) => state.apiKeyModalState);

  // Get store actions (these are stable references)
  const autoSelectBuffer = useAIChatStore((state) => state.autoSelectBuffer);
  const checkApiKey = useAIChatStore((state) => state.checkApiKey);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);
  const setInput = useAIChatStore((state) => state.setInput);
  const setIsTyping = useAIChatStore((state) => state.setIsTyping);
  const setStreamingMessageId = useAIChatStore((state) => state.setStreamingMessageId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const deleteChat = useAIChatStore((state) => state.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const addMessage = useAIChatStore((state) => state.addMessage);
  const updateMessage = useAIChatStore((state) => state.updateMessage);
  const setIsChatHistoryVisible = useAIChatStore((state) => state.setIsChatHistoryVisible);
  const setApiKeyModalState = useAIChatStore((state) => state.setApiKeyModalState);
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const getCurrentChat = useAIChatStore((state) => state.getCurrentChat);
  const getCurrentMessages = useAIChatStore((state) => state.getCurrentMessages);
  const switchToChat = useAIChatStore((state) => state.switchToChat);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Get current chat and messages directly from store
  const currentChat = getCurrentChat();
  const messages = getCurrentMessages();

  // Auto-select active buffer when it changes
  useEffect(() => {
    if (activeBuffer) {
      autoSelectBuffer(activeBuffer.id);
    }
  }, [activeBuffer, autoSelectBuffer]);

  // Check API keys on mount and when provider changes
  useEffect(() => {
    checkApiKey(settings.aiProviderId);
    checkAllProviderApiKeys();
  }, [settings.aiProviderId, checkApiKey, checkAllProviderApiKeys]);

  // Check Claude Code availability on mount
  useEffect(() => {
    const checkClaudeCodeStatus = async () => {
      try {
        const status = await invoke<ClaudeStatus>("get_claude_status");
        setClaudeCodeAvailability(status.interceptor_running);

        // If Claude Code is selected but not available, switch to first available provider
        if (settings.aiProviderId === "claude-code" && !status.interceptor_running) {
          const availableProviders = getAvailableProviders();
          if (availableProviders.length > 0) {
            const firstProvider = availableProviders[0];
            updateSetting("aiProviderId", firstProvider.id);
            updateSetting("aiModelId", firstProvider.models[0].id);
          }
        }
      } catch {
        // If we can't check status, assume it's not available
        setClaudeCodeAvailability(false);

        // Switch away from Claude Code if it's selected
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

  // Wrapper for deleteChat to handle event
  const handleDeleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    deleteChat(chatId);
  };

  // Handle new chat creation with claude-code restart
  const handleNewChat = async () => {
    const newChatId = createNewChat();

    // Restart claude-code for new context
    if (settings.aiProviderId === "claude-code") {
      try {
        // First stop the existing claude process
        await invoke("stop_claude_code");
        // Then start fresh
        await invoke("start_claude_code", {
          workspacePath: rootFolderPath || null,
        });
      } catch (error) {
        console.error("Failed to restart claude-code for new chat:", error);
      }
    }

    return newChatId;
  };

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Build context information for the AI (simplified, no memoization needed)
  const buildContext = (): ContextInfo => {
    const selectedBuffers = buffers.filter((buffer) => selectedBufferIds.has(buffer.id));
    const context: ContextInfo = {
      activeBuffer: activeBuffer || undefined,
      openBuffers: selectedBuffers,
      selectedFiles,
      selectedProjectFiles: Array.from(selectedFilesPaths),
      projectRoot: rootFolderPath,
      providerId: settings.aiProviderId,
    };

    if (activeBuffer) {
      // Determine language from file extension
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

  // Stop streaming response
  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
    setStreamingMessageId(null);
  };

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim() || !hasApiKey) return;

    // Auto-start claude-code if needed
    if (settings.aiProviderId === "claude-code") {
      try {
        await invoke("start_claude_code", {
          workspacePath: rootFolderPath || null,
        });
      } catch (error) {
        console.error("Failed to start claude-code:", error);
        // Continue anyway - the user might have claude running already
      }
    }

    // Create a new chat if we don't have one
    let chatId = currentChatId;
    if (!chatId) {
      chatId = createNewChat();
    }

    // Parse @ mentions and load referenced files
    const { processedMessage } = await parseMentionsAndLoadFiles(
      messageContent.trim(),
      allProjectFiles,
    );

    const context = buildContext();
    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageContent.trim(), // Show original message to user
      role: "user",
      timestamp: new Date(),
    };

    // Create initial assistant message for streaming
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: "",
      role: "assistant",
      timestamp: new Date(),
      isStreaming: true,
    };

    // Add messages to chat
    addMessage(chatId, userMessage);
    addMessage(chatId, assistantMessage);

    // Update chat title if this is the first message
    if (messages.length === 0) {
      const title =
        userMessage.content.length > 50
          ? `${userMessage.content.substring(0, 50)}...`
          : userMessage.content;
      updateChatTitle(chatId, title);
    }

    setInput("");
    setIsTyping(true);
    setStreamingMessageId(assistantMessageId);

    // Scroll to bottom after adding messages
    requestAnimationFrame(scrollToBottom);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Build conversation context - include previous messages for continuity
      // Filter out system messages to avoid the linter error
      const conversationContext = messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

      // Use the processed message with file contents for the AI
      const enhancedMessage = processedMessage;
      let currentAssistantMessageId = assistantMessageId;

      await getChatCompletionStream(
        settings.aiProviderId,
        settings.aiModelId,
        enhancedMessage,
        context,
        // onChunk - update the streaming message
        (chunk: string) => {
          const currentMessages = getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          updateMessage(chatId, currentAssistantMessageId, {
            content: (currentMsg?.content || "") + chunk,
          });
          // Scroll during streaming
          requestAnimationFrame(scrollToBottom);
        },
        // onComplete - mark streaming as finished
        () => {
          updateMessage(chatId, currentAssistantMessageId, {
            isStreaming: false,
          });
          setIsTyping(false);
          setStreamingMessageId(null);
          abortControllerRef.current = null;
        },
        // onError - handle errors
        (error: string) => {
          console.error("Streaming error:", error);
          const currentMessages = getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          updateMessage(chatId, currentAssistantMessageId, {
            content: currentMsg?.content || `Error: ${error}`,
            isStreaming: false,
          });
          setIsTyping(false);
          setStreamingMessageId(null);
          abortControllerRef.current = null;
        },
        conversationContext, // Pass conversation history for context
        // onNewMessage - create a new assistant message
        () => {
          const newMessageId = Date.now().toString();
          const newAssistantMessage: Message = {
            id: newMessageId,
            content: "",
            role: "assistant",
            timestamp: new Date(),
            isStreaming: true,
          };

          addMessage(chatId, newAssistantMessage);

          // Update the current message ID to append chunks to the new message
          currentAssistantMessageId = newMessageId;
          setStreamingMessageId(newMessageId);
          requestAnimationFrame(scrollToBottom);
        },
        // onToolUse - mark the current message as tool use
        (toolName: string, toolInput?: any) => {
          const currentMessages = getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          updateMessage(chatId, currentAssistantMessageId, {
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
        // onToolComplete - mark tool as complete
        (toolName: string) => {
          const currentMessages = getCurrentMessages();
          const currentMsg = currentMessages.find((m) => m.id === currentAssistantMessageId);
          updateMessage(chatId, currentAssistantMessageId, {
            toolCalls: currentMsg?.toolCalls?.map((tc) =>
              tc.name === toolName && !tc.isComplete ? { ...tc, isComplete: true } : tc,
            ),
          });
        },
      );
    } catch (error) {
      console.error("Failed to start streaming:", error);
      updateMessage(chatId, assistantMessageId, {
        content: "Error: Failed to connect to AI service. Please check your API key and try again.",
        isStreaming: false,
      });
      setIsTyping(false);
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  };

  // Memoized send message handler to prevent unnecessary re-renders
  const handleSendMessage = useCallback(async () => {
    await sendMessage(input);
  }, [sendMessage, input]);

  // Copy message content to clipboard
  const handleCopyMessage = useCallback(async (messageContent: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(messageContent);
      setCopiedMessageId(messageId);
      // Reset back to copy icon after 2 seconds
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  }, []);

  return (
    <div
      className={cn(
        "ai-chat-container flex h-full flex-col font-mono text-xs",
        "bg-secondary-bg text-text",
        className,
      )}
      style={{
        background: "var(--color-secondary-bg)",
        color: "var(--color-text)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: "var(--color-secondary-bg)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <button
          onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
          className="rounded p-1 transition-colors hover:bg-hover"
          style={{ color: "var(--color-text-lighter)" }}
          title="Toggle chat history"
        >
          <MessageSquare size={14} />
        </button>
        {currentChatId ? (
          <EditableChatTitle
            title={currentChat ? currentChat.title : "New Chat"}
            onUpdateTitle={(title) => updateChatTitle(currentChatId, title)}
          />
        ) : (
          <span className="font-medium">New Chat</span>
        )}
        <div className="flex-1" />
        <button
          onClick={handleNewChat}
          className="flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-hover"
          style={{ color: "var(--color-text-lighter)" }}
          title="New chat"
        >
          <Plus size={10} />
        </button>
      </div>

      {/* Messages */}
      <div className="scrollbar-hidden flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <div>
              <Sparkles size={24} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">AI Assistant</div>
              <div className="mt-1" style={{ color: "var(--color-text-lighter)" }}>
                Ask me anything about your code
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          // Check if this is the first assistant message in a sequence
          const isFirstAssistantInSequence =
            message.role === "assistant" &&
            (index === 0 || messages[index - 1].role !== "assistant");

          // Check if this message is primarily tool calls (empty content + tool calls)
          const isToolOnlyMessage =
            message.role === "assistant" &&
            message.toolCalls &&
            message.toolCalls.length > 0 &&
            (!message.content || message.content.trim().length === 0);

          // Check if previous message was also a tool-only message for even tighter spacing
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const previousMessageIsToolOnly =
            prevMessage &&
            prevMessage.role === "assistant" &&
            prevMessage.toolCalls &&
            prevMessage.toolCalls.length > 0 &&
            (!prevMessage.content || prevMessage.content.trim().length === 0);

          return (
            <div
              key={message.id}
              className={cn(
                isToolOnlyMessage ? (previousMessageIsToolOnly ? "px-3" : "px-3 pt-1") : "p-3",
                message.role === "user" && "flex justify-end",
              )}
            >
              {message.role === "user" ? (
                /* User Message - Subtle Chat Bubble */
                <div className="flex max-w-[80%] flex-col items-end">
                  <div
                    className="rounded-lg rounded-br-none px-3 py-2"
                    style={{
                      background: "var(--color-secondary-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  </div>
                </div>
              ) : isToolOnlyMessage ? (
                /* Tool-Only Message - Minimal Structure */
                message.toolCalls!.map((toolCall, toolIndex) => (
                  <ToolCallDisplay
                    key={`${message.id}-tool-${toolIndex}`}
                    toolName={toolCall.name}
                    input={toolCall.input}
                    output={toolCall.output}
                    error={toolCall.error}
                    isStreaming={!toolCall.isComplete && message.isStreaming}
                  />
                ))
              ) : (
                /* Assistant Message - Full Width with Header */
                <div className="group relative w-full">
                  {/* AI Message Header - Only show for first message in sequence */}
                  {isFirstAssistantInSequence && (
                    <div className="mb-2 flex select-none items-center gap-2">
                      <div
                        className="flex items-center gap-1"
                        style={{ color: "var(--color-text-lighter)" }}
                      >
                        <span>
                          {getProviderById(settings.aiProviderId)?.name || settings.aiProviderId}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Tool Calls */}
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
                        />
                      ))}
                    </div>
                  )}

                  {/* AI Message Content */}
                  {message.content && (
                    <div className="pr-1 leading-relaxed">
                      <MarkdownRenderer content={message.content} onApplyCode={onApplyCode} />
                    </div>
                  )}

                  {/* Copy Button - Positioned at bottom right */}
                  {message.content && (
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => handleCopyMessage(message.content, message.id)}
                        className="rounded p-1 opacity-60 transition-opacity hover:bg-hover hover:opacity-100"
                        title="Copy message"
                      >
                        {copiedMessageId === message.id ? (
                          <Check size={12} className="text-green-400" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* AI Chat Input Bar */}
      <AIChatInputBar
        buffers={buffers}
        allProjectFiles={allProjectFiles}
        onSendMessage={handleSendMessage}
        onStopStreaming={stopStreaming}
      />

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={apiKeyModalState.isOpen}
        onClose={() => setApiKeyModalState({ isOpen: false, providerId: null })}
        providerId={apiKeyModalState.providerId || ""}
        onSave={saveApiKey}
        onRemove={removeApiKey}
        hasExistingKey={
          apiKeyModalState.providerId ? hasProviderApiKey(apiKeyModalState.providerId) : false
        }
      />

      {/* Chat History Modal */}
      <ChatHistoryModal
        isOpen={isChatHistoryVisible}
        onClose={() => setIsChatHistoryVisible(false)}
        chats={chats}
        currentChatId={currentChatId}
        onSwitchToChat={switchToChat}
        onDeleteChat={handleDeleteChat}
        formatTime={formatTime}
      />
    </div>
  );
});

export default AIChat;

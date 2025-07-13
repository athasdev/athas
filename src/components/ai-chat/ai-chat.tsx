import {
  Bot,
  ChevronDown,
  Database,
  FileText,
  MessageSquare,
  Plus,
  Send,
  Square,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_PROVIDERS, getModelById, getProviderById } from "../../types/ai-provider";
import {
  getChatCompletionStream,
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "../../utils/ai-chat";
import { cn } from "../../utils/cn";
import { getLanguageFromFilename } from "../../utils/file-utils";
import ApiKeyModal from "../api-key-modal";
import ModelProviderSelector from "../model-provider-selector";
import OutlineView from "../outline-view";
import Button from "../ui/button";
import ChatHistoryModal from "./chat-history-modal";
import ClaudeStatusIndicator from "./claude-status";
import MarkdownRenderer from "./markdown-renderer";
import ToolCallDisplay from "./tool-call-display";
import type { AIChatProps, Chat, ContextInfo, Message } from "./types";
import { formatTime } from "./utils";

export default function AIChat({
  className,
  activeBuffer,
  buffers = [],
  rootFolderPath,
  selectedFiles = [],
  mode,
  onApplyCode,
}: AIChatProps) {
  // Chat History State
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isChatHistoryVisible, setIsChatHistoryVisible] = useState(false);

  // Provider and Model State
  const [currentProviderId, setCurrentProviderId] = useState("openai");
  const [currentModelId, setCurrentModelId] = useState("gpt-4o-mini");
  const [providerApiKeys, setProviderApiKeys] = useState<Map<string, boolean>>(new Map());
  const [apiKeyModalState, setApiKeyModalState] = useState<{
    isOpen: boolean;
    providerId: string | null;
  }>({ isOpen: false, providerId: null });

  // Chat State
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(new Set());
  const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isSendAnimating, setIsSendAnimating] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const contextDropdownRef = useRef<HTMLDivElement>(null);

  // Get current chat
  const currentChat = chats.find(chat => chat.id === currentChatId);
  const messages = useMemo(() => currentChat?.messages || [], [currentChat?.messages]);

  // Theme detection removed - was causing unnecessary re-renders

  // Click outside handler for context dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextDropdownRef.current &&
        !contextDropdownRef.current.contains(event.target as Node)
      ) {
        setIsContextDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load chats from localStorage on mount
  useEffect(() => {
    const savedChats = localStorage.getItem("athas-code-ai-chats");
    if (savedChats) {
      try {
        const parsedChats = JSON.parse(savedChats).map((chat: any) => ({
          ...chat,
          createdAt: new Date(chat.createdAt),
          lastMessageAt: new Date(chat.lastMessageAt),
          messages: chat.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
            toolCalls: msg.toolCalls?.map((tc: any) => ({
              ...tc,
              timestamp: new Date(tc.timestamp),
            })),
          })),
        }));
        setChats(parsedChats);

        // Set the most recent chat as current
        if (parsedChats.length > 0) {
          const mostRecent = parsedChats.sort(
            (a: Chat, b: Chat) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
          )[0];
          setCurrentChatId(mostRecent.id);
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
      }
    }
  }, []);

  // Save chats to localStorage whenever chats change (debounced)
  useEffect(() => {
    if (chats.length > 0) {
      const timeoutId = setTimeout(() => {
        localStorage.setItem("athas-code-ai-chats", JSON.stringify(chats));
      }, 1000); // Debounce localStorage writes by 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [chats]);

  // Create a new chat
  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "New Chat",
      messages: [],
      createdAt: new Date(),
      lastMessageAt: new Date(),
    };

    setChats(prev => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setIsChatHistoryVisible(false);
  };

  // Switch to a different chat
  const switchToChat = (chatId: string) => {
    setCurrentChatId(chatId);
    setIsChatHistoryVisible(false);
    // Stop any current streaming
    stopStreaming();
  };

  // Delete a chat
  const deleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setChats(prev => prev.filter(chat => chat.id !== chatId));

    // If we deleted the current chat, switch to the most recent one or create new
    if (chatId === currentChatId) {
      const remainingChats = chats.filter(chat => chat.id !== chatId);
      if (remainingChats.length > 0) {
        const mostRecent = remainingChats.sort(
          (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
        )[0];
        setCurrentChatId(mostRecent.id);
      } else {
        setCurrentChatId(null);
      }
    }
  };

  // Update chat title based on first message
  const updateChatTitle = (chatId: string, firstMessage: string) => {
    const title = firstMessage.length > 50 ? `${firstMessage.substring(0, 50)}...` : firstMessage;

    setChats(prev => prev.map(chat => (chat.id === chatId ? { ...chat, title } : chat)));
  };

  // Update messages in current chat
  const updateMessages = (newMessages: Message[]) => {
    if (!currentChatId) return;

    setChats(prev =>
      prev.map(chat =>
        chat.id === currentChatId
          ? {
              ...chat,
              messages: newMessages,
              lastMessageAt: new Date(),
            }
          : chat,
      ),
    );
  };

  const checkApiKey = useCallback(async () => {
    try {
      // Claude Code doesn't require an API key in the frontend
      if (currentProviderId === "claude-code") {
        setHasApiKey(true);
        return;
      }

      const token = await getProviderApiToken(currentProviderId);
      setHasApiKey(!!token);
    } catch (error) {
      console.error("Error checking API key:", error);
      setHasApiKey(false);
    }
  }, [currentProviderId]);

  const checkAllProviderApiKeys = useCallback(async () => {
    const newApiKeyMap = new Map<string, boolean>();

    for (const provider of AI_PROVIDERS) {
      try {
        // Claude Code doesn't require an API key in the frontend
        if (provider.id === "claude-code") {
          newApiKeyMap.set(provider.id, true);
          continue;
        }

        const token = await getProviderApiToken(provider.id);
        newApiKeyMap.set(provider.id, !!token);
      } catch (_error) {
        newApiKeyMap.set(provider.id, false);
      }
    }

    setProviderApiKeys(newApiKeyMap);
  }, []);

  // Check for API key on mount
  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  // Auto-select active buffer when it changes
  useEffect(() => {
    if (activeBuffer) {
      setSelectedBufferIds(prev => new Set([...prev, activeBuffer.id]));
    }
  }, [activeBuffer]);

  // Check for API key on mount and when provider changes
  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  // Check all provider API keys on mount
  useEffect(() => {
    checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys]);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Get selected buffers for context (memoized)
  const getSelectedBuffers = useMemo(() => {
    return buffers.filter(buffer => selectedBufferIds.has(buffer.id));
  }, [buffers, selectedBufferIds]);

  // Calculate approximate tokens (memoized)
  const calculateTokens = useMemo(() => {
    let totalChars = input.length;

    // Add characters from selected buffers (approximate)
    getSelectedBuffers.forEach(buffer => {
      if (buffer.content && !buffer.isSQLite) {
        totalChars += buffer.content.length;
      }
    });

    // Rough approximation: 1 token ≈ 4 characters for English text
    const estimatedTokens = Math.ceil(totalChars / 4);

    // Get max tokens from current model
    const currentModel = getModelById(currentProviderId, currentModelId);
    const maxTokens = currentModel?.maxTokens || 4096; // Fallback to 4k tokens

    return { estimatedTokens, maxTokens };
  }, [input, getSelectedBuffers, currentProviderId, currentModelId]);

  // Build context information for the AI (memoized)
  const buildContext = useMemo((): ContextInfo => {
    const context: ContextInfo = {
      activeBuffer: activeBuffer || undefined,
      openBuffers: getSelectedBuffers,
      selectedFiles,
      projectRoot: rootFolderPath,
      providerId: currentProviderId,
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
  }, [activeBuffer, getSelectedBuffers, selectedFiles, rootFolderPath, currentProviderId]);

  // Stop streaming response
  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
    setStreamingMessageId(null);
  };

  const sendMessage = async () => {
    if (!input.trim() || !hasApiKey) return;

    // Trigger send animation
    setIsSendAnimating(true);

    // Reset animation after the flying animation completes
    setTimeout(() => setIsSendAnimating(false), 800);

    // Create a new chat if we don't have one
    let chatId = currentChatId;
    if (!chatId) {
      const newChat: Chat = {
        id: Date.now().toString(),
        title: "New Chat",
        messages: [],
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };
      setChats(prev => [newChat, ...prev]);
      chatId = newChat.id;
      setCurrentChatId(chatId);
    }

    const context = buildContext;
    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
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

    const newMessages = [...messages, userMessage, assistantMessage];
    updateMessages(newMessages);

    // Update chat title if this is the first message
    if (messages.length === 0) {
      updateChatTitle(chatId, userMessage.content);
    }

    setInput("");
    setIsTyping(true);
    setStreamingMessageId(assistantMessageId);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Build conversation context - include previous messages for continuity
      // Filter out system messages to avoid the linter error
      const conversationContext = messages
        .filter(msg => msg.role !== "system")
        .map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

      const enhancedMessage = userMessage.content;
      let currentAssistantMessageId = assistantMessageId;

      await getChatCompletionStream(
        currentProviderId,
        currentModelId,
        enhancedMessage,
        context,
        // onChunk - update the streaming message
        (chunk: string) => {
          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === currentAssistantMessageId
                        ? { ...msg, content: msg.content + chunk }
                        : msg,
                    ),
                  }
                : chat,
            ),
          );
        },
        // onComplete - mark streaming as finished
        () => {
          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === currentAssistantMessageId ? { ...msg, isStreaming: false } : msg,
                    ),
                    lastMessageAt: new Date(),
                  }
                : chat,
            ),
          );
          setIsTyping(false);
          setStreamingMessageId(null);
          abortControllerRef.current = null;
        },
        // onError - handle errors
        (error: string) => {
          console.error("Streaming error:", error);
          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === currentAssistantMessageId
                        ? {
                            ...msg,
                            content: msg.content || `Error: ${error}`,
                            isStreaming: false,
                          }
                        : msg,
                    ),
                  }
                : chat,
            ),
          );
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

          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: [...chat.messages, newAssistantMessage],
                  }
                : chat,
            ),
          );

          // Update the current message ID to append chunks to the new message
          currentAssistantMessageId = newMessageId;
          setStreamingMessageId(newMessageId);
        },
        // onToolUse - mark the current message as tool use
        (toolName: string, toolInput?: any) => {
          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === currentAssistantMessageId
                        ? {
                            ...msg,
                            isToolUse: true,
                            toolName,
                            toolCalls: [
                              ...(msg.toolCalls || []),
                              {
                                name: toolName,
                                input: toolInput,
                                timestamp: new Date(),
                              },
                            ],
                          }
                        : msg,
                    ),
                  }
                : chat,
            ),
          );
        },
        // onToolComplete - mark tool as complete
        (toolName: string) => {
          setChats(prev =>
            prev.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === currentAssistantMessageId
                        ? {
                            ...msg,
                            toolCalls: msg.toolCalls?.map(tc =>
                              tc.name === toolName && !tc.isComplete
                                ? { ...tc, isComplete: true }
                                : tc,
                            ),
                          }
                        : msg,
                    ),
                  }
                : chat,
            ),
          );
        },
      );
    } catch (error) {
      console.error("Failed to start streaming:", error);
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map(msg =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        content:
                          "Error: Failed to connect to AI service. Please check your API key and try again.",
                        isStreaming: false,
                      }
                    : msg,
                ),
              }
            : chat,
        ),
      );
      setIsTyping(false);
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleBufferSelection = (bufferId: string) => {
    setSelectedBufferIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bufferId)) {
        newSet.delete(bufferId);
      } else {
        newSet.add(bufferId);
      }
      return newSet;
    });
  };

  // Handle provider/model selection
  const handleProviderChange = (providerId: string, modelId: string) => {
    setCurrentProviderId(providerId);
    setCurrentModelId(modelId);
  };

  // Handle API key request
  const handleApiKeyRequest = (providerId: string) => {
    setApiKeyModalState({ isOpen: true, providerId });
  };

  // Check if provider has API key
  const hasProviderApiKey = (providerId: string): boolean => {
    return providerApiKeys.get(providerId) || false;
  };

  // Handle API key save
  const handleApiKeySave = async (providerId: string, apiKey: string): Promise<boolean> => {
    try {
      const isValid = await validateProviderApiKey(providerId, apiKey);
      if (isValid) {
        await storeProviderApiToken(providerId, apiKey);
        await checkAllProviderApiKeys(); // Refresh all keys
        await checkApiKey(); // Refresh current provider key
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error saving API key:", error);
      return false;
    }
  };

  // Handle API key removal
  const handleApiKeyRemove = async (providerId: string): Promise<void> => {
    try {
      await removeProviderApiToken(providerId);
      await checkAllProviderApiKeys(); // Refresh all keys
      await checkApiKey(); // Refresh current provider key
    } catch (error) {
      console.error("Error removing API key:", error);
      throw error;
    }
  };

  const { estimatedTokens, maxTokens } = calculateTokens;

  if (mode === "outline") {
    const handleOutlineItemClick = (line: number) => {
      const event = new CustomEvent("navigate-to-line", {
        detail: { line },
      });
      window.dispatchEvent(event);
    };

    return (
      <OutlineView
        content={activeBuffer?.content}
        language={activeBuffer ? getLanguageFromFilename(activeBuffer.name) : undefined}
        onItemClick={handleOutlineItemClick}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn("flex h-full flex-col font-mono text-xs", "bg-primary-bg text-text", className)}
      style={{
        background: "var(--primary-bg)",
        color: "var(--text-color)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: "var(--secondary-bg)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <button
          onClick={() => setIsChatHistoryVisible(!isChatHistoryVisible)}
          className="rounded p-1 transition-colors hover:bg-hover"
          style={{ color: "var(--text-lighter)" }}
          title="Toggle chat history"
        >
          <MessageSquare size={14} />
        </button>
        <span className="font-medium">{currentChat ? currentChat.title : "New Chat"}</span>
        <div className="flex-1" />
        <button
          onClick={createNewChat}
          className="flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-hover"
          style={{ color: "var(--text-lighter)" }}
          title="New chat"
        >
          <Plus size={10} />
        </button>
      </div>

      {/* Messages */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <div>
              <Bot size={24} className="mx-auto mb-2 opacity-50" />
              <div className="text-sm">AI Assistant</div>
              <div className="mt-1" style={{ color: "var(--text-lighter)" }}>
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

          return (
            <div
              key={message.id}
              className={`${message.role === "user" ? "flex justify-end p-3" : "p-3"}`}
            >
              {message.role === "user" ? (
                /* User Message - Subtle Chat Bubble */
                <div className="flex max-w-[80%] flex-col items-end">
                  <div
                    className="rounded-lg rounded-br-none px-3 py-2"
                    style={{
                      background: "var(--secondary-bg)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  </div>
                </div>
              ) : (
                /* Assistant Message - Full Width with Header */
                <div className="w-full">
                  {/* AI Message Header - Only show for first message in sequence */}
                  {isFirstAssistantInSequence && (
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="flex items-center gap-1"
                        style={{ color: "var(--text-lighter)" }}
                      >
                        <span>{getProviderById(currentProviderId)?.name || currentProviderId}</span>
                        {message.isStreaming && (
                          <div className="ml-1 flex items-center gap-1">
                            <span className="h-1 w-1 animate-pulse rounded-full bg-text-lighter" />
                            <span
                              className="h-1 w-1 animate-pulse rounded-full bg-text-lighter"
                              style={{ animationDelay: "0.2s" }}
                            />
                            <span
                              className="h-1 w-1 animate-pulse rounded-full bg-text-lighter"
                              style={{ animationDelay: "0.4s" }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tool Calls */}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mb-3 space-y-2">
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

                      {message.isStreaming && (
                        <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-[var(--text-lighter)]" />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          background: "var(--secondary-bg)",
          borderTop: "1px solid var(--border-color)",
        }}
      >
        {/* Model Provider Selector and Mode Toggle */}
        <div className="px-2 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Context Selector Dropdown */}
              <div className="relative" ref={contextDropdownRef}>
                <button
                  onClick={() => setIsContextDropdownOpen(!isContextDropdownOpen)}
                  className="flex items-center gap-1 rounded px-2 pt-2 transition-colors hover:bg-hover"
                  style={{ color: "var(--text-lighter)" }}
                  title="Add context files"
                >
                  <FileText size={12} />
                  <span>Context ({selectedBufferIds.size})</span>
                  <ChevronDown size={10} />
                </button>

                {isContextDropdownOpen && (
                  <div
                    className="absolute top-full left-0 z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded shadow-lg"
                    style={{
                      background: "var(--primary-bg)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <div className="p-2">
                      <div className="mb-2 text-xs" style={{ color: "var(--text-lighter)" }}>
                        Select files to include as context:
                      </div>
                      {buffers.length === 0 ? (
                        <div className="p-2 text-xs" style={{ color: "var(--text-lighter)" }}>
                          No files available
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {buffers.map(buffer => (
                            <label
                              key={buffer.id}
                              className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-hover"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBufferIds.has(buffer.id)}
                                onChange={() => toggleBufferSelection(buffer.id)}
                                className="h-3 w-3"
                              />
                              <div className="flex min-w-0 flex-1 items-center gap-1">
                                {buffer.isSQLite ? <Database size={10} /> : <FileText size={10} />}
                                <span className="truncate text-xs">{buffer.name}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Context badges */}
        {selectedBufferIds.size > 0 && (
          <div className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-1">
              {Array.from(selectedBufferIds).map(bufferId => {
                const buffer = buffers.find(b => b.id === bufferId);
                if (!buffer) return null;
                return (
                  <div
                    key={bufferId}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs"
                    style={{
                      background: "var(--hover-color)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    {buffer.isSQLite ? <Database size={8} /> : <FileText size={8} />}
                    <span className="max-w-20 truncate">{buffer.name}</span>
                    <button
                      onClick={() => toggleBufferSelection(bufferId)}
                      className="transition-colors hover:text-red-400"
                      style={{ color: "var(--text-lighter)" }}
                    >
                      <X size={8} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-3">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasApiKey ? "Ask about your code..." : "Configure API key to enable AI chat..."
              }
              disabled={isTyping || !hasApiKey}
              className="min-h-[60px] flex-1 resize-none rounded px-3 py-2 focus:outline-none disabled:opacity-50"
              style={{
                background: "var(--primary-bg)",
                border: "1px solid var(--border-color)",
                color: "var(--text-color)",
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="hidden sm:block" style={{ color: "var(--text-lighter)" }}>
              <span
                className={
                  estimatedTokens > maxTokens * 0.8
                    ? "text-orange-400"
                    : estimatedTokens > maxTokens * 0.9
                      ? "text-red-400"
                      : ""
                }
              >
                {estimatedTokens.toLocaleString()}/{(maxTokens / 1000).toFixed(0)}k tokens
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ClaudeStatusIndicator
                isActive={currentProviderId === "claude-code"}
                workspacePath={rootFolderPath}
              />
              <ModelProviderSelector
                currentProviderId={currentProviderId}
                currentModelId={currentModelId}
                onProviderChange={handleProviderChange}
                onApiKeyRequest={handleApiKeyRequest}
                hasApiKey={hasProviderApiKey}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="submit"
                  disabled={(!input.trim() && !isTyping) || !hasApiKey}
                  onClick={isTyping && streamingMessageId ? stopStreaming : sendMessage}
                  className={cn(
                    "flex items-center justify-center rounded p-0",
                    "send-button-hover button-transition",
                    isTyping && streamingMessageId && !isSendAnimating && "button-morphing",
                  )}
                  style={{
                    color:
                      isTyping && streamingMessageId
                        ? "rgb(59, 130, 246)"
                        : input.trim() && !isTyping && hasApiKey
                          ? "white"
                          : "var(--text-lighter)",
                    border:
                      isTyping && streamingMessageId
                        ? "1px solid rgba(59, 130, 246, 0.3)"
                        : "1px solid transparent",
                    cursor: (!input.trim() && !isTyping) || !hasApiKey ? "not-allowed" : "pointer",
                  }}
                  title={isTyping && streamingMessageId ? "Stop generation" : "Send message"}
                >
                  {isTyping && streamingMessageId && !isSendAnimating ? (
                    <Square size={10} className="transition-all duration-300" />
                  ) : (
                    <Send
                      size={10}
                      className={cn(
                        "send-icon transition-all duration-200",
                        isSendAnimating && "flying",
                      )}
                    />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={apiKeyModalState.isOpen}
        onClose={() => setApiKeyModalState({ isOpen: false, providerId: null })}
        providerId={apiKeyModalState.providerId || ""}
        onSave={handleApiKeySave}
        onRemove={handleApiKeyRemove}
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
        onDeleteChat={deleteChat}
        formatTime={formatTime}
      />
    </div>
  );
}

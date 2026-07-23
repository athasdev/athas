import { listen } from "@tauri-apps/api/event";
import "../../styles/ai-chat.css";
import { KeyIcon as KeyRound } from "@/ui/icons";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendChatAcpEvent, type ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import { extractFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import { buildConversationHistory } from "@/features/ai/lib/conversation-history";
import {
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { getChatCompletionStream, isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpEvent, AcpPermissionOption } from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useProjectStore } from "@/features/window/stores/project.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/ui/message-scroller";
import { cn } from "@/utils/cn";
import { useChatActions, useChatState } from "../../hooks/use-chat-store";
import AIChatInputBar from "../input/chat-input-bar";
import { AgentShortcuts } from "./agent-shortcuts";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";

function normalizeAgentSessionTitle(value: string): string | null {
  const normalized = value
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const words = normalized.split(" ").slice(0, 2);
  const title = words.join(" ").trim();
  return title || null;
}

function fallbackAgentSessionTitle(message: string): string {
  return message.length > 50 ? `${message.substring(0, 50)}...` : message;
}

function getPermissionSummary(permission: {
  description: string;
  permissionType: string;
  resource: string;
}) {
  return (
    permission.description ||
    [permission.permissionType, permission.resource].filter(Boolean).join(" ")
  ).trim();
}

function getFallbackPermissionOptions(): AcpPermissionOption[] {
  return [
    { id: "reject", name: "Deny", kind: "reject_once" },
    { id: "allow", name: "Allow", kind: "allow_once" },
  ];
}

function isPermissionApproval(option: AcpPermissionOption) {
  return option.kind === "allow_once" || option.kind === "allow_always";
}

function getPermissionOptionLabel(option: AcpPermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow";
    case "allow_always":
      return "Always";
    case "reject_once":
      return "Deny";
    case "reject_always":
      return "Never";
    default:
      return option.name;
  }
}

function getPermissionOptionTooltip(option: AcpPermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow once";
    case "allow_always":
      return "Always allow this request type";
    case "reject_once":
      return "Deny once";
    case "reject_always":
      return "Always deny this request type";
    default:
      return option.name;
  }
}

function getPermissionOptionClassName(option: AcpPermissionOption) {
  switch (option.kind) {
    case "allow_always":
      return "border-success/30 bg-success/10 text-success hover:border-success/40 hover:bg-success/15 hover:text-success";
    case "allow_once":
      return "border-border/70 bg-hover/50 text-text hover:bg-hover";
    case "reject_always":
      return "border-error/35 bg-error/10 text-error hover:border-error/45 hover:bg-error/15 hover:text-error";
    case "reject_once":
      return "";
    default:
      return "";
  }
}

function getMessageSearchMatches(messages: Message[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return messages.flatMap((message) => {
    const content = message.content.toLowerCase();
    const matches: Array<{ messageId: string }> = [];
    let index = content.indexOf(normalizedQuery);

    while (index !== -1) {
      matches.push({ messageId: message.id });
      index = content.indexOf(normalizedQuery, index + normalizedQuery.length);
    }

    return matches;
  });
}

const AIChat = memo(function AIChat({
  className,
  surfaceId,
  chatId,
  isActiveSurface = true,
  activeBuffer,
  buffers = [],
  selectedFiles = [],
  allProjectFiles = [],
  onApplyCode,
}: AIChatProps) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const subscription = useAuthStore((state) => state.subscription);
  const enterprisePolicy = subscription?.enterprise?.policy;
  const isAiChatBlockedByPolicy = Boolean(
    enterprisePolicy?.managedMode && !enterprisePolicy.aiChatEnabled,
  );

  const chatState = useChatState();
  const chatActions = useChatActions();
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const { showToast } = useToast();

  const abortControllerRef = useRef<AbortController | null>(null);
  const [permissionQueue, setPermissionQueue] = useState<
    Array<{
      requestId: string;
      description: string;
      permissionType: string;
      resource: string;
      options: Extract<AcpEvent, { type: "permission_request" }>["options"];
    }>
  >([]);
  const [acpEvents, setAcpEvents] = useState<ChatAcpEvent[]>([]);
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [activeMessageSearchIndex, setActiveMessageSearchIndex] = useState(0);
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(new Set());
  const [selectedFilesPaths, setSelectedFilesPaths] = useState<Set<string>>(new Set());
  const [isSurfaceTyping, setIsSurfaceTyping] = useState(false);
  const [surfaceStreamingMessageId, setSurfaceStreamingMessageId] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const messageQueueRef = useRef<string[]>([]);
  const effectiveChatId = chatId ?? chatState.currentChatId;
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === effectiveChatId),
    [chatState.chats, effectiveChatId],
  );
  const currentAgentId = currentChat?.agentId ?? useAIChatStore.getState().selectedAgentId;
  const messageSearchMatches = useMemo(
    () => getMessageSearchMatches(currentChat?.messages ?? [], messageSearchQuery),
    [currentChat?.messages, messageSearchQuery],
  );
  const activeMessageSearchMatch = messageSearchMatches[activeMessageSearchIndex] ?? null;

  const closeMessageSearch = useCallback(() => {
    setIsMessageSearchOpen(false);
    setMessageSearchQuery("");
    setActiveMessageSearchIndex(0);
  }, []);

  const goToPreviousMessageSearchMatch = useCallback(() => {
    if (messageSearchMatches.length === 0) return;
    setActiveMessageSearchIndex((index) =>
      index === 0 ? messageSearchMatches.length - 1 : index - 1,
    );
  }, [messageSearchMatches.length]);

  const goToNextMessageSearchMatch = useCallback(() => {
    if (messageSearchMatches.length === 0) return;
    setActiveMessageSearchIndex((index) => (index + 1) % messageSearchMatches.length);
  }, [messageSearchMatches.length]);

  useEffect(() => {
    chatActions.checkApiKey(aiProviderId);
    chatActions.checkAllProviderApiKeys();
  }, [aiProviderId, chatActions.checkApiKey, chatActions.checkAllProviderApiKeys]);

  // Clear ACP events when switching chats
  useEffect(() => {
    setAcpEvents([]);
    closeMessageSearch();
    setSelectedBufferIds(new Set());
    setSelectedFilesPaths(new Set());
  }, [closeMessageSearch, effectiveChatId]);

  useEffect(() => {
    setActiveMessageSearchIndex(0);
  }, [messageSearchQuery]);

  useEffect(() => {
    if (messageSearchMatches.length === 0) {
      setActiveMessageSearchIndex(0);
      return;
    }

    setActiveMessageSearchIndex((index) => Math.min(index, messageSearchMatches.length - 1));
  }, [messageSearchMatches.length]);

  useEffect(() => {
    if (!isActiveSurface || isAiChatBlockedByPolicy) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsMessageSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActiveSurface, isAiChatBlockedByPolicy]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupAcpStateSync = async () => {
      unlisten = await listen<AcpEvent>("acp-event", ({ payload }) => {
        const store = useAIChatStore.getState();

        switch (payload.type) {
          case "slash_commands_update":
            store.setAvailableSlashCommands(payload.commands);
            break;
          case "session_mode_update":
            store.setSessionModeState(
              payload.modeState.currentModeId,
              payload.modeState.availableModes,
            );
            break;
          case "current_mode_update":
            store.setCurrentModeId(payload.currentModeId);
            break;
          case "config_options_update":
            store.setSessionConfigOptions(payload.configOptions);
            break;
          case "session_info_update": {
            const chat =
              store.chats.find((item) => item.acpSessionId === payload.sessionId) ??
              (store.acpStatus?.sessionId === payload.sessionId ? store.getCurrentChat() : null);
            const nextTitle = chat ? getChatTitleFromSessionInfo(chat.title, payload.title) : null;
            if (chat && nextTitle) {
              store.updateChatTitle(chat.id, nextTitle);
            }
            break;
          }
          case "status_changed":
            store.setAcpStatus(payload.status);
            if (!payload.status.running) {
              store.setAvailableSlashCommands([]);
              store.setSessionModeState(null, []);
              store.setSessionConfigOptions([]);
            }
            break;
          default:
            break;
        }
      });
    };

    setupAcpStateSync().catch((error) => {
      if (!disposed) {
        console.error("Failed to initialize ACP state sync listener:", error);
      }
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const appendAcpEvent = useCallback((event: ChatAcpEventInput) => {
    setAcpEvents((prev) => appendChatAcpEvent(prev, event));
  }, []);

  // Agent availability is handled dynamically by the agent selector.

  const handleDeleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    chatActions.deleteChat(chatId);
  };

  const updateInitialAgentSessionTitle = useCallback(
    async (chatId: string, userMessage: string) => {
      const fallbackTitle = fallbackAgentSessionTitle(userMessage);
      chatActions.updateChatTitle(chatId, fallbackTitle);

      const authState = useAuthStore.getState();
      const enterprisePolicy = authState.subscription?.enterprise?.policy;
      const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
      const isPro = hasProductCapability(authState.subscription, "hostedAi");

      if (!isPro || (managedPolicy && !managedPolicy.aiCompletionEnabled)) {
        return;
      }

      const model = useSettingsStore.getState().settings.aiAutocompleteModelId;
      if (!model) return;

      try {
        const { editedText } = await requestInlineEdit(
          {
            model,
            beforeSelection: "",
            selectedText: userMessage,
            afterSelection: "",
            instruction:
              "Name the software feature or task being worked on. Return exactly one or two words, no punctuation, no quotes, no explanation. Prefer a concrete product feature label over a generic verb.",
            filePath: "agent-session-title",
            languageId: "text",
          },
          { useByok: false },
        );

        const generatedTitle = normalizeAgentSessionTitle(editedText);
        if (!generatedTitle) return;

        const currentChat = useAIChatStore.getState().getChatById(chatId);
        if (!currentChat) return;

        if (currentChat.title === fallbackTitle || currentChat.title === "New Session") {
          chatActions.updateChatTitle(chatId, generatedTitle);
        }
      } catch (error) {
        console.debug("Failed to generate agent session title:", error);
      }
    },
    [chatActions],
  );

  const buildContext = async (agentId: string, providerId: string): Promise<ContextInfo> => {
    const selectedBuffers = buffers.filter(
      (buffer) => buffer.type !== "agent" && selectedBufferIds.has(buffer.id),
    );
    const selectedActiveBuffer =
      activeBuffer && activeBuffer.type !== "agent" && selectedBufferIds.has(activeBuffer.id)
        ? activeBuffer
        : undefined;

    let activeBufferContext: (typeof activeBuffer & { webViewerContent?: string }) | undefined =
      selectedActiveBuffer;
    if (selectedActiveBuffer?.type === "webViewer" && selectedActiveBuffer.url) {
      const { fetchWebPageContent } = await import("@/features/ai/services/web-content-service");
      const webContent = await fetchWebPageContent(selectedActiveBuffer.url);
      activeBufferContext = {
        ...selectedActiveBuffer,
        webViewerContent: webContent,
      };
    }

    const context: ContextInfo = {
      activeBuffer: activeBufferContext,
      openBuffers: selectedBuffers,
      selectedFiles,
      selectedProjectFiles: Array.from(selectedFilesPaths),
      projectRoot: rootFolderPath,
      providerId,
      agentId,
    };

    if (selectedActiveBuffer && selectedActiveBuffer.type !== "webViewer") {
      const extension = selectedActiveBuffer.path.split(".").pop()?.toLowerCase() || "";
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
    const pendingPermissions = permissionQueue;
    setPermissionQueue([]);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSurfaceTyping(false);
    setSurfaceStreamingMessageId(null);

    if (isAcpAgent(currentAgentId)) {
      try {
        await AcpStreamHandler.cancelPrompt();
        if (pendingPermissions.length > 0) {
          await Promise.all(
            pendingPermissions.map((item) =>
              AcpStreamHandler.respondToPermission(item.requestId, false, true),
            ),
          );
        }
      } catch (error) {
        console.error("Failed to cancel ACP prompt:", error);
      }
    }
  };

  const updateStreamingAssistantMessage = useCallback(
    (
      chatId: string,
      messageId: string,
      mutate: (currentMessage: Message | undefined) => Partial<Message>,
    ) => {
      const currentMessages = useAIChatStore.getState().getMessagesForChat(chatId);
      const currentMessage = currentMessages.find((message) => message.id === messageId);
      chatActions.updateMessage(chatId, messageId, mutate(currentMessage));
    },
    [chatActions.updateMessage],
  );

  const processMessage = async (
    messageContent: string,
    options: { editedUserMessageId?: string } = {},
  ) => {
    const store = useAIChatStore.getState();
    const targetChat = effectiveChatId
      ? store.chats.find((chat) => chat.id === effectiveChatId)
      : null;
    const currentAgentId = targetChat?.agentId ?? store.getCurrentAgentId();
    const isAcp = isAcpAgent(currentAgentId);
    const trimmedMessageContent = messageContent.trim();
    // For ACP agents, we don't need an API key.
    // For Custom API, we need an API key to be set
    if (!trimmedMessageContent || (!isAcp && !store.hasApiKey)) return;
    if (options.editedUserMessageId && currentAgentId !== "custom") return;

    // Agents are started automatically by AcpStreamHandler when needed

    let targetChatId = effectiveChatId ?? store.currentChatId;
    if (!targetChatId) {
      targetChatId = chatActions.createNewChat(currentAgentId);
    } else {
      targetChatId = chatActions.ensureChatSession(targetChatId, currentAgentId, {
        activate: !chatId,
      });
    }

    const existingMessages = useAIChatStore.getState().getMessagesForChat(targetChatId);
    const editedUserMessageIndex = options.editedUserMessageId
      ? existingMessages.findIndex(
          (message) => message.id === options.editedUserMessageId && message.role === "user",
        )
      : -1;
    if (options.editedUserMessageId && editedUserMessageIndex === -1) return;

    const conversationContext = buildConversationHistory(
      editedUserMessageIndex >= 0
        ? existingMessages.slice(0, editedUserMessageIndex)
        : existingMessages,
    );
    const userMessage: Message =
      editedUserMessageIndex >= 0
        ? {
            ...existingMessages[editedUserMessageIndex],
            content: trimmedMessageContent,
            timestamp: new Date(),
          }
        : {
            id: Date.now().toString(),
            content: trimmedMessageContent,
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

    if (options.editedUserMessageId) {
      const didReplace = chatActions.replaceUserMessage(
        targetChatId,
        options.editedUserMessageId,
        trimmedMessageContent,
      );
      if (!didReplace) return;
    } else {
      chatActions.addMessage(targetChatId, userMessage);
    }
    chatActions.addMessage(targetChatId, assistantMessage);

    const currentMessages = useAIChatStore.getState().getMessagesForChat(targetChatId);
    if (currentMessages.length === 2) {
      void updateInitialAgentSessionTitle(targetChatId, userMessage.content);
    }

    setIsSurfaceTyping(true);
    setSurfaceStreamingMessageId(assistantMessageId);

    abortControllerRef.current = new AbortController();
    let currentAssistantMessageId = assistantMessageId;
    let currentAssistantRawContent = "";
    let acpProducedStateOnlyUpdate = false;
    let acpCommandResultLabel: string | null = null;

    try {
      const { processedMessage, mentionedFiles } = await parseMentionsAndLoadFiles(
        trimmedMessageContent,
        allProjectFiles,
      );
      const latestSettings = useSettingsStore.getState().settings;
      const context = await buildContext(currentAgentId, latestSettings.aiProviderId);
      context.mentionedFiles = mentionedFiles;

      // Handle direct ACP UI intents locally so they are always reliable.
      if (isAcp) {
        const directAction = parseDirectAcpUiAction(trimmedMessageContent);
        if (directAction) {
          const bufferActions = useBufferStore.getState().actions;
          if (directAction.kind === "open_web_viewer" && directAction.url) {
            if (!useSettingsStore.getState().settings.coreFeatures.webViewer) {
              chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
                content: "Web Viewer is disabled. Enable it in Settings > Features to open URLs.",
                isStreaming: false,
              });
              setIsSurfaceTyping(false);
              setSurfaceStreamingMessageId(null);
              return;
            }

            bufferActions.openWebViewerBuffer(directAction.url);
            chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
              content: `Opened ${directAction.url} in Athas web viewer.`,
              isStreaming: false,
            });
          } else if (directAction.kind === "open_terminal" && directAction.command) {
            bufferActions.openTerminalBuffer({
              command: directAction.command,
              name: directAction.command,
            });
            chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
              content: `Opened terminal and ran \`${directAction.command}\`.`,
              isStreaming: false,
            });
          }

          setIsSurfaceTyping(false);
          setSurfaceStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
          return;
        }
      }

      const enhancedMessage = isAcp ? trimmedMessageContent : processedMessage;
      if (isAcp) {
        setAcpEvents([]);
      }

      await getChatCompletionStream(
        currentAgentId,
        latestSettings.aiProviderId,
        latestSettings.aiModelId,
        enhancedMessage,
        context,
        (chunk: string) => {
          currentAssistantRawContent += chunk;
          const extracted = extractFollowUpActions(currentAssistantRawContent);
          updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
            content: extracted.content,
            followUpActions: extracted.actions,
          }));
        },
        () => {
          const currentMessage = chatActions
            .getMessagesForChat(targetChatId)
            .find((message) => message.id === currentAssistantMessageId);
          const hasVisibleResponse = Boolean(
            currentMessage?.content?.trim() ||
            currentMessage?.toolCalls?.length ||
            currentMessage?.images?.length ||
            currentMessage?.resources?.length,
          );

          if (!hasVisibleResponse) {
            if (isAcpAgent(currentAgentId) && acpProducedStateOnlyUpdate) {
              const slashCommand = trimmedMessageContent.match(/^\/([^\s]+)/)?.[1];
              const fallbackContent =
                acpCommandResultLabel ||
                (slashCommand ? `Applied \`/${slashCommand}\`.` : "Session updated.");

              updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
                content: fallbackContent,
                isStreaming: false,
              }));
              setIsSurfaceTyping(false);
              setSurfaceStreamingMessageId(null);
              abortControllerRef.current = null;
              processQueuedMessages();
              return;
            }

            const isAcp = isAcpAgent(currentAgentId);
            const fallbackMessage = isAcp
              ? "The selected agent did not return a visible response. Try sending the message again."
              : "The selected provider did not return a visible response. Try another model or send the message again.";
            const emptyResponseSource = isAcp ? "agent session" : "provider request";
            updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
              content: `[ERROR_BLOCK]
title: No Response
code: EMPTY_RESPONSE
message: ${fallbackMessage}
details: The ${emptyResponseSource} completed, but no content, tool output, or resource was returned.
[/ERROR_BLOCK]`,
              isStreaming: false,
            }));
            setIsSurfaceTyping(false);
            setSurfaceStreamingMessageId(null);
            abortControllerRef.current = null;
            processQueuedMessages();
            return;
          }

          chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
            isStreaming: false,
          });
          setIsSurfaceTyping(false);
          setSurfaceStreamingMessageId(null);
          setAcpEvents((prev) => prev.filter((event) => event.kind !== "thinking"));
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

          const isAcpAuthError =
            isAcpAgent(currentAgentId) &&
            (mainError.includes("Authentication required") ||
              errorDetails.includes("Authentication required"));

          if (isAcpAuthError) {
            errorTitle = "Authentication Required";
            errorCode = "AUTH_REQUIRED";
            errorMessage =
              "The selected agent needs external authentication before it can accept prompts.";

            if (
              mainError.includes("Method not implemented") ||
              errorDetails.includes("Method not implemented")
            ) {
              errorDetails =
                "This ACP adapter does not implement the protocol authenticate flow. Complete login in the underlying CLI/adapter, then try again.";
            } else if (!errorDetails) {
              errorDetails =
                "Complete authentication in the underlying CLI/adapter, then try again.";
            }
          }

          if (canReconnect) {
            errorTitle = "Connection Lost";
            errorCode = "RECONNECT";
          }

          const shouldSuppressToast =
            isAcpAgent(currentAgentId) &&
            (mainError.includes("did not return any response") || errorCode === "RECONNECT");

          const formattedError = `[ERROR_BLOCK]
title: ${errorTitle}
code: ${errorCode}
message: ${errorMessage}
details: ${errorDetails || mainError}
[/ERROR_BLOCK]`;

          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              content: currentMessage?.content || formattedError,
              isStreaming: false,
            }),
          );
          if (!shouldSuppressToast) {
            showToast({
              message: errorMessage,
              type: "error",
            });
          }
          setIsSurfaceTyping(false);
          setSurfaceStreamingMessageId(null);
          abortControllerRef.current = null;
          processQueuedMessages();
        },
        conversationContext,
        () => {
          const newMessageId = Date.now().toString();
          currentAssistantRawContent = "";
          const newAssistantMessage: Message = {
            id: newMessageId,
            content: "",
            role: "assistant",
            timestamp: new Date(),
            isStreaming: true,
          };

          chatActions.addMessage(targetChatId, newAssistantMessage);
          currentAssistantMessageId = newMessageId;
          setSurfaceStreamingMessageId(newMessageId);
        },
        (event) => {
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              isToolUse: true,
              toolName: event.toolName,
              toolCalls: [
                ...(currentMessage?.toolCalls || []),
                createToolCall(
                  event.toolName,
                  event.input,
                  event.toolId,
                  event.kind,
                  event.status,
                  event.locations,
                ),
              ],
            }),
          );
        },
        (event) => {
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              toolCalls: updateToolCall(currentMessage?.toolCalls || [], {
                id: event.toolId,
                name: event.toolName,
                input: event.input,
                output: event.output,
                error: event.error,
                kind: event.kind,
                status: event.status,
                locations: event.locations,
              }),
            }),
          );
        },
        (toolName: string, toolId?: string, output?: unknown, error?: string) => {
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              toolCalls: markToolCallComplete(
                currentMessage?.toolCalls || [],
                toolName,
                toolId,
                output,
                error,
              ),
            }),
          );
        },
        (event) => {
          appendAcpEvent({
            kind: "permission",
            label: "Permission requested",
            detail: event.description || `${event.permissionType} ${event.resource}`.trim(),
            state: "info",
          });
          setPermissionQueue((prev) => [
            ...prev,
            {
              requestId: event.requestId,
              description: event.description,
              permissionType: event.permissionType,
              resource: event.resource,
              options: event.options,
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
            case "thought_chunk":
              break;
            case "tool_start":
            case "tool_update":
              break;
            case "tool_complete":
              break;
            case "permission_request":
              break; // Handled separately with permission UI
            case "prompt_complete":
              break; // Not useful to show
            case "session_mode_update":
              acpProducedStateOnlyUpdate = true;
              acpCommandResultLabel = event.modeState.currentModeId
                ? `Mode set to \`${event.modeState.currentModeId}\`.`
                : "Session mode updated.";
              break;
            case "config_options_update":
              acpProducedStateOnlyUpdate = true;
              acpCommandResultLabel =
                event.configOptions.length === 1
                  ? "Session option updated."
                  : "Session options updated.";
              break;
            case "session_info_update":
              acpProducedStateOnlyUpdate = true;
              acpCommandResultLabel = event.title
                ? `Session title updated to "${event.title}".`
                : "Session metadata updated.";
              if (event.title) {
                appendAcpEvent({
                  kind: "status",
                  label: "Session title updated",
                  detail: event.title,
                  state: "info",
                });
              }
              break;
            case "current_mode_update":
              acpProducedStateOnlyUpdate = true;
              acpCommandResultLabel = `Mode set to \`${event.currentModeId}\`.`;
              break;
            case "slash_commands_update":
              acpProducedStateOnlyUpdate = true;
              acpCommandResultLabel = "Slash commands refreshed.";
              break; // Not useful to show
            case "plan_update": {
              const summary =
                event.entries.length > 0
                  ? event.entries.map((entry) => entry.content).join(" | ")
                  : "No plan steps";
              appendAcpEvent({
                kind: "plan",
                label: `Plan updated (${event.entries.length} steps)`,
                detail: summary,
                state: "info",
              });
              break;
            }
            case "usage_update": {
              break;
            }
            case "status_changed":
              useAIChatStore.getState().setAcpStatus(event.status);
              break; // internal state sync
            case "error":
              appendAcpEvent({
                kind: "error",
                label: "Agent error",
                detail: event.error,
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
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              images: [...(currentMessage?.images || []), { data, mediaType }],
            }),
          );
        },
        (uri: string, name: string | null) => {
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              resources: [...(currentMessage?.resources || []), { uri, name }],
            }),
          );
        },
        targetChatId,
      );
    } catch (error) {
      console.error("Failed to start streaming:", error);
      chatActions.updateMessage(targetChatId, assistantMessageId, {
        content:
          "Error: Failed to connect to Agent service. Please check your API key and try again.",
        isStreaming: false,
      });
      setIsSurfaceTyping(false);
      setSurfaceStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  };

  const processQueuedMessages = useCallback(async () => {
    if (isSurfaceTyping || surfaceStreamingMessageId) {
      return;
    }

    const nextMessage = messageQueueRef.current.shift();
    setQueueCount(messageQueueRef.current.length);
    if (nextMessage) {
      console.log("Processing next queued message:", nextMessage);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await processMessage(nextMessage);
    }
  }, [isSurfaceTyping, surfaceStreamingMessageId]);

  const sendMessage = useCallback(
    async (messageContent: string) => {
      const isAcp = isAcpAgent(currentAgentId);
      // For ACP agents, we don't need an API key.
      if (!messageContent.trim() || (!isAcp && !chatState.hasApiKey)) return;

      if (isSurfaceTyping || surfaceStreamingMessageId) {
        messageQueueRef.current.push(messageContent);
        setQueueCount(messageQueueRef.current.length);
        return;
      }

      await processMessage(messageContent);
    },
    [chatState.hasApiKey, currentAgentId, isSurfaceTyping, surfaceStreamingMessageId],
  );

  const handleSendMessage = useCallback(
    async (messageContent: string) => {
      await sendMessage(messageContent);
    },
    [sendMessage],
  );

  const handleEditUserMessage = async (messageId: string, content: string) => {
    if (isSurfaceTyping || surfaceStreamingMessageId || currentChat?.agentId !== "custom") {
      return;
    }

    await processMessage(content, { editedUserMessageId: messageId });
  };

  useEffect(() => {
    const pendingLaunch = chatState.pendingAgentLaunchRequest;
    if (!pendingLaunch) return;
    if (pendingLaunch.chatId !== effectiveChatId) return;
    if (activeBuffer?.type !== "agent") return;
    if (activeBuffer.sessionId !== pendingLaunch.chatId) return;
    if (isSurfaceTyping || surfaceStreamingMessageId) return;
    if (!isAcpAgent(pendingLaunch.agentId) && !chatState.hasApiKey) return;

    setSelectedBufferIds(new Set(pendingLaunch.selectedBufferIds));
    setSelectedFilesPaths(new Set(pendingLaunch.selectedFilesPaths));
    chatActions.setPendingAgentLaunchRequest(null);
    void sendMessage(pendingLaunch.prompt);
  }, [
    chatActions,
    effectiveChatId,
    chatState.hasApiKey,
    isSurfaceTyping,
    chatState.pendingAgentLaunchRequest,
    surfaceStreamingMessageId,
    activeBuffer,
    sendMessage,
  ]);

  const currentPermission = permissionQueue[0];
  const currentPermissionSummary = currentPermission ? getPermissionSummary(currentPermission) : "";
  const currentPermissionOptions = currentPermission
    ? currentPermission.options.length > 0
      ? currentPermission.options
      : getFallbackPermissionOptions()
    : [];
  const isNewSession = (currentChat?.messages.length ?? 0) === 0 && acpEvents.length === 0;
  const useInitialComposer = isNewSession && !currentPermission;
  const handlePermission = async (approved: boolean, optionId?: string) => {
    if (!currentPermission) return;
    try {
      const option = currentPermission.options.find((item) => item.id === optionId);
      appendAcpEvent({
        kind: "permission",
        label: "Permission response",
        detail: option?.name || (approved ? "allow" : "deny"),
        state: approved ? "success" : "info",
      });
      await AcpStreamHandler.respondToPermission(
        currentPermission.requestId,
        approved,
        false,
        optionId,
      );
    } finally {
      setPermissionQueue((prev) => prev.slice(1));
    }
  };

  return (
    <div
      className={`ai-chat-surface font-sans flex h-full flex-col bg-transparent text-text ui-text-sm ${className || ""}`}
    >
      <ChatHeader
        chatId={effectiveChatId}
        onDeleteChat={handleDeleteChat}
        onSwitchChat={chatId ? openAgentBuffer : chatActions.switchToChat}
        isMessageSearchOpen={isMessageSearchOpen}
        messageSearchQuery={messageSearchQuery}
        onToggleMessageSearch={() => {
          if (isMessageSearchOpen) {
            closeMessageSearch();
            return;
          }

          setIsMessageSearchOpen(true);
        }}
        onCloseMessageSearch={closeMessageSearch}
        onMessageSearchQueryChange={setMessageSearchQuery}
        messageSearchMatchCount={messageSearchMatches.length}
        activeMessageSearchIndex={activeMessageSearchIndex}
        onPreviousMessageSearchMatch={goToPreviousMessageSearchMatch}
        onNextMessageSearchMatch={goToNextMessageSearchMatch}
      />
      {isAiChatBlockedByPolicy ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-border bg-secondary-bg/40 p-4 text-center">
            <p className="font-medium ui-text-sm text-text">Agent is disabled</p>
            <p className="mt-2 text-text-lighter ui-text-sm">
              Your organization policy has disabled Agent for this workspace.
            </p>
          </div>
        </div>
      ) : (
        <>
          {useInitialComposer ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
              <div className="flex w-full max-w-[720px] flex-col gap-4">
                <AgentShortcuts surfaceId={surfaceId} />
                <AIChatInputBar
                  key={effectiveChatId ?? "new-session"}
                  surfaceId={surfaceId}
                  buffers={buffers}
                  allProjectFiles={allProjectFiles}
                  currentAgentId={currentAgentId}
                  isTyping={isSurfaceTyping}
                  streamingMessageId={surfaceStreamingMessageId}
                  queueCount={queueCount}
                  selectedBufferIds={selectedBufferIds}
                  selectedFilesPaths={selectedFilesPaths}
                  onToggleBufferSelection={(bufferId) =>
                    setSelectedBufferIds((current) => {
                      const next = new Set(current);
                      if (next.has(bufferId)) next.delete(bufferId);
                      else next.add(bufferId);
                      return next;
                    })
                  }
                  onToggleFileSelection={(filePath) =>
                    setSelectedFilesPaths((current) => {
                      const next = new Set(current);
                      if (next.has(filePath)) next.delete(filePath);
                      else next.add(filePath);
                      return next;
                    })
                  }
                  onSetSelectedBufferIds={setSelectedBufferIds}
                  onSetSelectedFilesPaths={setSelectedFilesPaths}
                  isActiveSurface={isActiveSurface}
                  presentation="initial"
                  onSendMessage={handleSendMessage}
                  onStopStreaming={stopStreaming}
                />
              </div>
            </div>
          ) : (
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
              <MessageScroller>
                <MessageScrollerViewport>
                  <ChatMessages
                    surfaceId={surfaceId}
                    chatId={effectiveChatId}
                    onApplyCode={onApplyCode}
                    onSendFollowUp={handleSendMessage}
                    onEditUserMessage={handleEditUserMessage}
                    canEditUserMessages={
                      currentChat?.agentId === "custom" &&
                      chatState.hasApiKey &&
                      !isSurfaceTyping &&
                      !surfaceStreamingMessageId &&
                      !isAiChatBlockedByPolicy
                    }
                    acpEvents={acpEvents}
                    searchQuery={messageSearchQuery}
                    activeSearchMessageId={activeMessageSearchMatch?.messageId ?? null}
                    activeSearchIndex={activeMessageSearchIndex}
                  />
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}

          {currentPermission && (
            <div className="bg-transparent px-3 pt-2 ui-text-sm">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-primary-bg/92 px-2 shadow-[var(--shadow-card)]">
                <KeyRound className="size-3.5 shrink-0 text-text-lighter" weight="duotone" />
                <div
                  className="min-w-0 flex-1 truncate text-text"
                  title={`${currentPermission.permissionType} - ${currentPermission.resource}`}
                >
                  <span className="font-medium text-text-light">Permission</span>
                  <span className="px-1.5 text-text-lighter">/</span>
                  <span className="font-mono">{currentPermissionSummary}</span>
                </div>
                {permissionQueue.length > 1 ? (
                  <Badge variant="muted" size="compact" className="shrink-0">
                    +{permissionQueue.length - 1}
                  </Badge>
                ) : null}
                <div className="flex shrink-0 items-center gap-1">
                  {currentPermissionOptions.map((option) => {
                    const approved = isPermissionApproval(option);
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant={approved ? "default" : "danger"}
                        onClick={() =>
                          handlePermission(
                            approved,
                            currentPermission.options.length > 0 ? option.id : undefined,
                          )
                        }
                        className={cn("h-6 rounded-md px-2", getPermissionOptionClassName(option))}
                        tooltip={getPermissionOptionTooltip(option)}
                        tooltipSide="top"
                      >
                        {getPermissionOptionLabel(option)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!useInitialComposer ? (
            <AIChatInputBar
              key={effectiveChatId ?? "new-session"}
              surfaceId={surfaceId}
              buffers={buffers}
              allProjectFiles={allProjectFiles}
              currentAgentId={currentAgentId}
              isTyping={isSurfaceTyping}
              streamingMessageId={surfaceStreamingMessageId}
              queueCount={queueCount}
              selectedBufferIds={selectedBufferIds}
              selectedFilesPaths={selectedFilesPaths}
              onToggleBufferSelection={(bufferId) =>
                setSelectedBufferIds((current) => {
                  const next = new Set(current);
                  if (next.has(bufferId)) next.delete(bufferId);
                  else next.add(bufferId);
                  return next;
                })
              }
              onToggleFileSelection={(filePath) =>
                setSelectedFilesPaths((current) => {
                  const next = new Set(current);
                  if (next.has(filePath)) next.delete(filePath);
                  else next.add(filePath);
                  return next;
                })
              }
              onSetSelectedBufferIds={setSelectedBufferIds}
              onSetSelectedFilesPaths={setSelectedFilesPaths}
              isActiveSurface={isActiveSurface}
              onSendMessage={handleSendMessage}
              onStopStreaming={stopStreaming}
            />
          ) : null}
        </>
      )}
    </div>
  );
});

export default AIChat;

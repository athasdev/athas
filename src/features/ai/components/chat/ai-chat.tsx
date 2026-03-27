import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ApiKeyModal from "@/features/ai/components/api-key-modal";
import { truncateDetail } from "@/features/ai/lib/acp-event-timeline";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import {
  getPendingAcpPermissions,
  getStaleAcpPermissions,
  reconcileIdleAcpRestore,
} from "@/features/ai/lib/chat-acp-activity";
import { isCompactionTriggerEnabled } from "@/features/ai/lib/chat-compaction-policy";
import { buildConversationHistory } from "@/features/ai/lib/chat-context";
import {
  createHarnessChatScopeId,
  createHarnessSessionKey,
  DEFAULT_HARNESS_SESSION_KEY,
  filterChatsForScope,
  getDefaultChatTitle,
  isDefaultHarnessSessionKey,
  PANEL_CHAT_SCOPE_ID,
} from "@/features/ai/lib/chat-scope";
import {
  formatStreamErrorBlock,
  getStreamErrorInfo,
  getStreamRetryDelayMs,
  shouldAutoRetryStreamError,
} from "@/features/ai/lib/chat-stream-retry";
import { parseMentionsAndLoadFiles } from "@/features/ai/lib/file-mentions";
import {
  cancelHarnessRuntimePrompt,
  getHarnessRuntimeSessionTranscript,
  getHarnessRuntimeStatus,
  listHarnessRuntimeSessions,
  resolveHarnessRuntimeBackendForScope,
  respondToHarnessPermission,
} from "@/features/ai/lib/harness-runtime";
import { getMostRecentClosedHarnessSession } from "@/features/ai/lib/harness-session-lifecycle";
import { getHarnessTrustState } from "@/features/ai/lib/harness-trust-state";
import {
  buildPiNativeChatMessagesFromTranscript,
  buildPiNativeRuntimeStateFromSession,
  derivePiNativeSessionTitle,
  shouldReconcilePiNativeSession,
  shouldReuseCurrentHarnessSessionForPiNativeResume,
} from "@/features/ai/lib/pi-native-restore";
import { createToolCall, markToolCallComplete } from "@/features/ai/lib/tool-call-state";
import type { AcpEvent, AcpToolLocation } from "@/features/ai/types/acp";
import type { AIChatProps, Message } from "@/features/ai/types/ai-chat";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import { useProjectStore } from "@/stores/project-store";
import { getChatCompletionStream, isAcpAgent } from "@/utils/ai-chat";
import { cn } from "@/utils/cn";
import type { ContextInfo } from "@/utils/types";
import { useChatActions, useChatState } from "../../hooks/use-chat-store";
import { useAIChatStore } from "../../store/store";
import ChatHistorySidebar from "../history/sidebar";
import AIChatInputBar from "../input/chat-input-bar";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { HarnessSessionRail } from "./harness-session-rail";

const createMessageId = () => crypto.randomUUID();
const MAX_STREAM_RETRY_ATTEMPTS = 2;

const isContextOverflowError = (error: string): boolean =>
  /(context|token).*(length|limit|window|maximum|too long)|max[_\s-]?tokens/i.test(error);

const getLatestHarnessRailEvent = (events: ChatAcpEvent[]): ChatAcpEvent | null =>
  [...events].reverse().find((event) => {
    if (event.kind === "permission" || event.kind === "error" || event.kind === "tool") {
      return true;
    }

    if (event.kind === "plan" || event.kind === "mode") {
      return true;
    }

    return event.state === "running" || event.state === "error" || Boolean(event.detail);
  }) ??
  events[events.length - 1] ??
  null;

const normalizeToolLocations = (locations?: AcpToolLocation[] | null) =>
  locations?.map((location) => ({ path: location.path, line: location.line ?? null }));

const summarizeToolPayload = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? truncateDetail(normalized) : undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" && serialized !== "[]"
      ? truncateDetail(serialized)
      : undefined;
  } catch {
    return undefined;
  }
};

const getToolCompletionData = (event: Extract<AcpEvent, { type: "tool_complete" }>) => {
  const locations = normalizeToolLocations(event.locations);
  const output = event.output;
  const detail =
    summarizeToolPayload(output) ??
    locations?.[0]?.path?.split("/").pop() ??
    (event.success ? "completed" : "failed");

  return {
    detail,
    tool: {
      output,
      locations,
      error: event.success ? undefined : (summarizeToolPayload(output) ?? "Tool failed"),
    },
  };
};

const AIChat = memo(function AIChat({
  className,
  surface = "panel",
  sessionKey,
  scopeId,
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

  const resolvedScopeId =
    scopeId ?? (surface === "harness" ? createHarnessChatScopeId(sessionKey) : PANEL_CHAT_SCOPE_ID);
  const chatState = useChatState(resolvedScopeId);
  const chatActions = useChatActions(resolvedScopeId);
  const closedBuffersHistory = useBufferStore.use.closedBuffersHistory();
  const { closeBuffer, createAgentBuffer, openAgentBuffer, reopenClosedHarnessSession } =
    useBufferStore.use.actions();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const nativeSessionRestoreAttemptRef = useRef<string | null>(null);
  const [harnessSessionStatuses, setHarnessSessionStatuses] = useState<Record<string, boolean>>({});
  const [recentPiNativeSessions, setRecentPiNativeSessions] = useState<
    Awaited<ReturnType<typeof listHarnessRuntimeSessions>>
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

  const scopedChats = useMemo(
    () => filterChatsForScope(chatState.chats, resolvedScopeId),
    [chatState.chats, resolvedScopeId],
  );
  const acpResumeKey = resolvedScopeId;
  const currentChat = useMemo(
    () => scopedChats.find((chat) => chat.id === chatState.currentChatId),
    [chatState.currentChatId, scopedChats],
  );
  const acpEvents = currentChat?.acpActivity?.events ?? [];
  const pendingPermissions = useMemo(
    () => getPendingAcpPermissions(currentChat?.acpActivity),
    [currentChat?.acpActivity],
  );
  const stalePermissions = useMemo(
    () => getStaleAcpPermissions(currentChat?.acpActivity),
    [currentChat?.acpActivity],
  );
  const currentPermission = pendingPermissions[0];
  const [permissionValue, setPermissionValue] = useState("");
  const currentAgentId = chatActions.getCurrentAgentId();
  const runtimeBackend = useMemo(
    () => resolveHarnessRuntimeBackendForScope(resolvedScopeId, buffers, activeBuffer ?? null),
    [activeBuffer, buffers, resolvedScopeId],
  );
  const currentPiNativeSessionPath =
    currentChat?.acpState?.runtimeState?.source === "pi-native"
      ? currentChat.acpState.runtimeState.sessionPath
      : null;

  useEffect(() => {
    if (!currentPermission) {
      setPermissionValue("");
      return;
    }

    setPermissionValue(currentPermission.defaultValue ?? currentPermission.options?.[0] ?? "");
  }, [currentPermission]);

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
        await cancelHarnessRuntimePrompt(resolvedScopeId, buffers, activeBuffer ?? null);
        if (pendingPermissions.length > 0) {
          await Promise.all(
            pendingPermissions.map((item) =>
              respondToHarnessPermission(
                item.requestId,
                false,
                true,
                resolvedScopeId,
                buffers,
                undefined,
                activeBuffer ?? null,
              ),
            ),
          );
          chatActions.markPendingAcpPermissionsStale();
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

    if (isCompactionTriggerEnabled(settings.aiAutoCompactionPolicy, "threshold")) {
      await chatActions.compactChat("threshold");
    }

    const currentChatBeforeSend = chatActions.getCurrentChat();
    const conversationContext = currentChatBeforeSend
      ? buildConversationHistory(currentChatBeforeSend)
      : [];
    const shouldUpdateTitle =
      !currentChatBeforeSend ||
      currentChatBeforeSend.messages.length === 0 ||
      currentChatBeforeSend.title === getDefaultChatTitle(surface);

    const { processedMessage } = await parseMentionsAndLoadFiles(
      messageContent.trim(),
      allProjectFiles,
    );

    const context = await buildContext(currentAgentId);
    const userMessageId = createMessageId();
    const userMessage: Message = {
      id: userMessageId,
      lineageMessageId: userMessageId,
      content: messageContent.trim(),
      role: "user",
      timestamp: new Date(),
    };

    const assistantMessageId = createMessageId();
    const assistantMessage: Message = {
      id: assistantMessageId,
      lineageMessageId: assistantMessageId,
      content: "",
      role: "assistant",
      timestamp: new Date(),
      isStreaming: true,
    };

    chatActions.addMessage(chatId, userMessage);
    chatActions.addMessage(chatId, assistantMessage);

    if (shouldUpdateTitle) {
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

      const enhancedMessage = processedMessage;

      let didOverflowRetry = false;
      let streamRetryAttempt = 0;
      const startCompletion = async (history = conversationContext) =>
        getChatCompletionStream(
          currentAgentId,
          settings.aiProviderId,
          settings.aiModelId,
          enhancedMessage,
          context,
          (chunk: string) => {
            updateStreamingAssistantMessage(
              chatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                content: (currentMessage?.content || "") + chunk,
              }),
            );
            requestAnimationFrame(scrollToBottom);
          },
          () => {
            if (streamRetryAttempt > 0) {
              chatActions.appendAcpActivityEvent({
                kind: "status",
                label: "Retry recovered",
                detail: `Succeeded after ${streamRetryAttempt} retr${
                  streamRetryAttempt === 1 ? "y" : "ies"
                }`,
                state: "success",
              });
              streamRetryAttempt = 0;
            }
            chatActions.updateMessage(chatId, currentAssistantMessageId, {
              isStreaming: false,
            });
            chatActions.setIsTyping(false);
            chatActions.setStreamingMessageId(null);
            abortControllerRef.current = null;
            processQueuedMessages();
          },
          (error: string, canReconnect?: boolean) => {
            void (async () => {
              console.error("Streaming error:", error);

              if (
                isCompactionTriggerEnabled(settings.aiAutoCompactionPolicy, "overflow") &&
                !didOverflowRetry &&
                isContextOverflowError(error)
              ) {
                didOverflowRetry = true;
                const compacted = await chatActions.compactChat("overflow");
                if (compacted) {
                  const retryChat = chatActions.getCurrentChat();
                  const retryHistory = retryChat
                    ? buildConversationHistory({
                        ...retryChat,
                        messages: retryChat.messages.filter(
                          (message) =>
                            message.id !== userMessageId &&
                            message.id !== currentAssistantMessageId,
                        ),
                      })
                    : history;
                  await startCompletion(retryHistory);
                  return;
                }
              }

              const errorInfo = getStreamErrorInfo(error, canReconnect);
              const currentStreamingMessage = chatActions
                .getCurrentMessages()
                .find((message) => message.id === currentAssistantMessageId);
              const nextRetryAttempt = streamRetryAttempt + 1;

              if (
                shouldAutoRetryStreamError({
                  error: errorInfo,
                  attempt: nextRetryAttempt,
                  maxAttempts: MAX_STREAM_RETRY_ATTEMPTS,
                  hasToolCalls: (currentStreamingMessage?.toolCalls?.length ?? 0) > 0,
                  pendingPermissionCount: pendingPermissions.length,
                })
              ) {
                streamRetryAttempt = nextRetryAttempt;
                const delayMs = getStreamRetryDelayMs(streamRetryAttempt);
                chatActions.appendAcpActivityEvent({
                  kind: "status",
                  label: "Retrying response",
                  detail: `${errorInfo.title} · attempt ${streamRetryAttempt}/${MAX_STREAM_RETRY_ATTEMPTS}`,
                  state: "running",
                });
                updateStreamingAssistantMessage(chatId, currentAssistantMessageId, () => ({
                  content: "",
                  isToolUse: false,
                  toolName: undefined,
                  toolCalls: [],
                  images: [],
                  resources: [],
                  isStreaming: true,
                }));
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                await startCompletion(history);
                return;
              }

              streamRetryAttempt = 0;
              const formattedError = formatStreamErrorBlock(errorInfo);

              updateStreamingAssistantMessage(
                chatId,
                currentAssistantMessageId,
                (currentMessage) => ({
                  content: currentMessage?.content || formattedError,
                  isStreaming: false,
                }),
              );
              chatActions.setIsTyping(false);
              chatActions.setStreamingMessageId(null);
              abortControllerRef.current = null;
              processQueuedMessages();
            })();
          },
          history,
          () => {
            const newMessageId = createMessageId();
            const newAssistantMessage: Message = {
              id: newMessageId,
              lineageMessageId: newMessageId,
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
            updateStreamingAssistantMessage(
              chatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                isToolUse: true,
                toolName,
                toolCalls: [
                  ...(currentMessage?.toolCalls || []),
                  createToolCall(toolName, toolInput, toolId),
                ],
              }),
            );
          },
          (toolName: string, toolId?: string, output?: unknown, error?: string) => {
            updateStreamingAssistantMessage(
              chatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                toolCalls: markToolCallComplete(currentMessage?.toolCalls || [], toolName, toolId, {
                  output,
                  error,
                }),
              }),
            );
          },
          (event) => {
            chatActions.addAcpPermissionRequest({
              requestId: event.requestId,
              description: event.description,
              permissionType: event.permissionType,
              resource: event.resource,
              title: event.title,
              placeholder: event.placeholder,
              defaultValue: event.defaultValue,
              options: event.options,
            });
            chatActions.appendAcpActivityEvent({
              id: `permission-${event.requestId}`,
              kind: "permission",
              label: "Permission requested",
              detail: truncateDetail(event.description),
              state: "info",
            });
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
                chatActions.appendAcpActivityEvent({
                  kind: "thinking",
                  label: "Thinking",
                  state: "running",
                });
                break;
              }
              case "tool_start": {
                chatActions.appendAcpActivityEvent({
                  id: `tool-${event.toolId}`,
                  kind: "tool",
                  label: event.toolName,
                  detail: "running",
                  state: "running",
                  tool: {
                    input: event.input,
                  },
                });
                break;
              }
              case "tool_complete": {
                const completion = getToolCompletionData(event);
                chatActions.completeAcpToolEvent(
                  `tool-${event.toolId}`,
                  event.success,
                  completion.tool,
                );
                if (completion.detail !== (event.success ? "completed" : "failed")) {
                  chatActions.appendAcpActivityEvent({
                    kind: "tool",
                    label: event.success ? "Tool output" : "Tool failure",
                    detail: completion.detail,
                    state: event.success ? "info" : "error",
                  });
                }
                break;
              }
              case "permission_request":
                break; // Handled separately with permission UI
              case "prompt_complete":
                break; // Not useful to show
              case "session_mode_update":
                if (event.modeState.currentModeId) {
                  chatActions.appendAcpActivityEvent({
                    kind: "mode",
                    label: "Mode changed",
                    detail: event.modeState.currentModeId,
                    state: "info",
                  });
                }
                break;
              case "current_mode_update":
                chatActions.appendAcpActivityEvent({
                  kind: "mode",
                  label: "Mode changed",
                  detail: event.currentModeId,
                  state: "info",
                });
                break;
              case "slash_commands_update":
                break; // Not useful to show
              case "runtime_state_update":
                break; // Internal runtime state sync
              case "plan_update": {
                const summary =
                  event.entries.length > 0
                    ? event.entries
                        .slice(0, 2)
                        .map((entry) => entry.content)
                        .join(" | ")
                    : "No plan steps";
                chatActions.setAcpPlanEntries(event.entries);
                chatActions.appendAcpActivityEvent({
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
                chatActions.appendAcpActivityEvent({
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
            updateStreamingAssistantMessage(
              chatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                images: [...(currentMessage?.images || []), { data, mediaType }],
              }),
            );
            requestAnimationFrame(scrollToBottom);
          },
          (uri: string, name: string | null) => {
            updateStreamingAssistantMessage(
              chatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                resources: [...(currentMessage?.resources || []), { uri, name }],
              }),
            );
            requestAnimationFrame(scrollToBottom);
          },
          surface,
          acpResumeKey,
          runtimeBackend,
        );
      await startCompletion();
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
      console.log(`Processing next ${nextMessage.kind} message:`, nextMessage.content);
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
  const currentSessionKey = sessionKey ?? DEFAULT_HARNESS_SESSION_KEY;
  const latestHarnessRailEvent = useMemo(() => getLatestHarnessRailEvent(acpEvents), [acpEvents]);
  const harnessTrustState = useMemo(
    () =>
      getHarnessTrustState({
        agentId: currentAgentId,
        mode: chatState.mode,
        isRunning:
          (harnessSessionStatuses[currentSessionKey] ?? false) ||
          chatState.isTyping ||
          chatState.queueCount > 0,
        queueCount: chatState.queueCount,
        pendingPermissionCount: pendingPermissions.length,
        stalePermissionCount: stalePermissions.length,
        latestEvent: latestHarnessRailEvent,
      }),
    [
      chatState.isTyping,
      chatState.mode,
      chatState.queueCount,
      currentAgentId,
      currentSessionKey,
      harnessSessionStatuses,
      latestHarnessRailEvent,
      pendingPermissions.length,
      stalePermissions.length,
    ],
  );
  const harnessSessions = useMemo(
    () =>
      buffers
        .filter((buffer) => buffer.isAgent && buffer.agentSessionId)
        .map((buffer) => ({
          bufferId: buffer.id,
          sessionKey: buffer.agentSessionId!,
          title: buffer.name,
          isActive: buffer.agentSessionId === currentSessionKey,
          isDefault: isDefaultHarnessSessionKey(buffer.agentSessionId!),
          state:
            buffer.agentSessionId === currentSessionKey
              ? harnessTrustState.kind
              : harnessSessionStatuses[buffer.agentSessionId!]
                ? "running"
                : "idle",
        })),
    [buffers, currentSessionKey, harnessSessionStatuses, harnessTrustState.kind],
  );
  const recentPiNativeRailSessions = useMemo(
    () =>
      recentPiNativeSessions.map((session) => ({
        path: session.path,
        title: derivePiNativeSessionTitle(session),
        detail: session.messageCount === 1 ? "1 message" : `${session.messageCount} messages`,
        isCurrent: session.path === currentPiNativeSessionPath,
      })),
    [currentPiNativeSessionPath, recentPiNativeSessions],
  );
  const hasClosedHarnessSession = useMemo(
    () => getMostRecentClosedHarnessSession(closedBuffersHistory) !== null,
    [closedBuffersHistory],
  );

  const handlePermission = async (approved: boolean, cancelled = false, value?: string) => {
    if (!currentPermission) return;
    try {
      chatActions.appendAcpActivityEvent({
        kind: "permission",
        label: "Permission response",
        detail: cancelled ? "cancel" : approved ? "allow" : "deny",
        state: approved ? "success" : "info",
      });
      await respondToHarnessPermission(
        currentPermission.requestId,
        approved,
        cancelled,
        resolvedScopeId,
        buffers,
        value,
        activeBuffer ?? null,
      );
      chatActions.resolveAcpPermissionRequest(
        currentPermission.requestId,
        approved && !cancelled ? "approved" : "denied",
      );
    } finally {
      // Activity is persisted in the chat store; no local queue to drain.
    }
  };

  const handleCreateHarnessSession = useCallback(() => {
    createAgentBuffer({ backend: runtimeBackend });
  }, [createAgentBuffer, runtimeBackend]);

  const handleSelectHarnessSession = useCallback(
    (nextSessionKey: string) => {
      openAgentBuffer(nextSessionKey, { backend: runtimeBackend });
    },
    [openAgentBuffer, runtimeBackend],
  );

  const handleCloseHarnessSession = useCallback(
    (bufferId: string) => {
      closeBuffer(bufferId);
    },
    [closeBuffer],
  );

  const handleReopenClosedHarnessSession = useCallback(() => {
    void reopenClosedHarnessSession();
  }, [reopenClosedHarnessSession]);

  const handleOpenRecentPiNativeSession = useCallback(
    async (sessionPath: string) => {
      const session = recentPiNativeSessions.find((entry) => entry.path === sessionPath);
      if (!session) {
        return;
      }

      try {
        const transcript = await getHarnessRuntimeSessionTranscript(
          "pi-native",
          "pi",
          session.path,
        );
        const shouldReuseCurrentSession = shouldReuseCurrentHarnessSessionForPiNativeResume({
          sessionKey,
          chat: currentChat,
        });
        const nextSessionKey =
          shouldReuseCurrentSession && sessionKey ? sessionKey : createHarnessSessionKey();
        const targetScopeId = createHarnessChatScopeId(nextSessionKey);
        const targetChatStore = useAIChatStore.getState();

        openAgentBuffer(nextSessionKey, { backend: "pi-native" });

        const targetChatId = targetChatStore.ensureChatForAgent("pi", targetScopeId);
        targetChatStore.setAcpRuntimeState(
          buildPiNativeRuntimeStateFromSession(session),
          targetScopeId,
        );
        targetChatStore.replaceChatMessages(
          targetChatId,
          buildPiNativeChatMessagesFromTranscript(transcript),
        );
        targetChatStore.updateChatTitle(targetChatId, derivePiNativeSessionTitle(session));
      } catch (error) {
        console.error("Failed to open recent Pi native session:", error);
      }
    },
    [currentChat, openAgentBuffer, recentPiNativeSessions, sessionKey],
  );

  const handleContinueChatFromHistory = useCallback(
    (chatId: string) => {
      chatActions.continueChatInPlace(chatId);
    },
    [chatActions],
  );

  const handleForkChatFromHistory = useCallback(
    async (chatId: string) => {
      if (surface === "harness") {
        const nextSessionKey = createHarnessSessionKey();
        openAgentBuffer(nextSessionKey, { backend: runtimeBackend });
        await chatActions.forkChatFromChat(chatId, createHarnessChatScopeId(nextSessionKey));
        return;
      }

      await chatActions.forkChatFromChat(chatId, resolvedScopeId);
    },
    [chatActions, openAgentBuffer, resolvedScopeId, runtimeBackend, surface],
  );

  useEffect(() => {
    if (surface !== "harness") {
      return;
    }

    const harnessSessionKeys = buffers
      .filter((buffer) => buffer.isAgent && buffer.agentSessionId)
      .map((buffer) => buffer.agentSessionId!);

    if (harnessSessionKeys.length === 0) {
      setHarnessSessionStatuses({});
      return;
    }

    let disposed = false;

    const refreshHarnessSessionStatuses = async () => {
      const nextStatuses = await Promise.all(
        harnessSessionKeys.map(async (harnessSessionKey) => {
          try {
            const status = await getHarnessRuntimeStatus(
              createHarnessChatScopeId(harnessSessionKey),
              buffers,
            );
            return [harnessSessionKey, status.running] as const;
          } catch (error) {
            console.error("Failed to refresh Harness session status", error);
            return [harnessSessionKey, false] as const;
          }
        }),
      );

      if (disposed) {
        return;
      }

      setHarnessSessionStatuses(Object.fromEntries(nextStatuses));
    };

    void refreshHarnessSessionStatuses();

    const statusInterval = window.setInterval(() => {
      void refreshHarnessSessionStatuses();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(statusInterval);
    };
  }, [buffers, surface]);

  useEffect(() => {
    if (
      surface !== "harness" ||
      runtimeBackend !== "pi-native" ||
      currentAgentId !== "pi" ||
      !rootFolderPath
    ) {
      setRecentPiNativeSessions([]);
      return;
    }

    let disposed = false;

    void listHarnessRuntimeSessions("pi-native", "pi", rootFolderPath)
      .then((sessions) => {
        if (!disposed) {
          setRecentPiNativeSessions(sessions.slice(0, 6));
        }
      })
      .catch((error) => {
        console.error("Failed to load recent Pi native sessions:", error);
        if (!disposed) {
          setRecentPiNativeSessions([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    currentAgentId,
    currentChat?.lastMessageAt,
    currentPiNativeSessionPath,
    rootFolderPath,
    runtimeBackend,
    surface,
  ]);

  useEffect(() => {
    if (surface !== "harness" || !currentChat) {
      return;
    }

    let cancelled = false;

    const reconcileRestoredHarnessState = async () => {
      try {
        const status = await getHarnessRuntimeStatus(
          resolvedScopeId,
          buffers,
          activeBuffer ?? null,
        );
        if (cancelled) {
          return;
        }

        const reconciled = reconcileIdleAcpRestore(currentChat.acpActivity, status);
        if (!reconciled.shouldResetTransientUi) {
          return;
        }

        const currentScopeState = useAIChatStore.getState().chatScopes[resolvedScopeId];
        if (currentScopeState?.isTyping) {
          useAIChatStore.getState().setIsTyping(false, resolvedScopeId);
        }

        if (currentScopeState?.streamingMessageId) {
          useAIChatStore.getState().setStreamingMessageId(null, resolvedScopeId);
        }

        if (pendingPermissions.length > 0) {
          useAIChatStore.getState().markPendingAcpPermissionsStale(resolvedScopeId);
        }
      } catch (error) {
        console.error("Failed to reconcile restored Harness session state", error);
      }
    };

    void reconcileRestoredHarnessState();

    return () => {
      cancelled = true;
    };
  }, [activeBuffer, buffers, currentChat?.id, pendingPermissions.length, resolvedScopeId, surface]);

  useEffect(() => {
    if (!currentChat) {
      return;
    }

    if (
      !shouldReconcilePiNativeSession({
        surface,
        runtimeBackend,
        agentId: currentAgentId,
        workspacePath: rootFolderPath ?? null,
        chat: currentChat,
      })
    ) {
      return;
    }

    const currentChatId = currentChat.id;
    const restoreAttemptKey = [
      resolvedScopeId,
      currentChatId,
      runtimeBackend,
      currentAgentId,
      rootFolderPath ?? "",
    ].join(":");

    if (nativeSessionRestoreAttemptRef.current === restoreAttemptKey) {
      return;
    }

    nativeSessionRestoreAttemptRef.current = restoreAttemptKey;

    const reconcileNativeSession = async () => {
      try {
        const sessions = await listHarnessRuntimeSessions(
          runtimeBackend,
          currentAgentId,
          rootFolderPath ?? null,
        );
        if (sessions.length === 0) {
          return;
        }

        const latestSession = sessions[0];
        const liveCurrentChat = useAIChatStore.getState().getCurrentChat(resolvedScopeId);
        if (
          !liveCurrentChat ||
          liveCurrentChat.id !== currentChatId ||
          !shouldReconcilePiNativeSession({
            surface,
            runtimeBackend,
            agentId: currentAgentId,
            workspacePath: rootFolderPath ?? null,
            chat: liveCurrentChat,
          })
        ) {
          return;
        }

        const transcript = await getHarnessRuntimeSessionTranscript(
          runtimeBackend,
          currentAgentId,
          latestSession.path,
        );
        const hydratedCurrentChat = useAIChatStore.getState().getCurrentChat(resolvedScopeId);
        if (
          !hydratedCurrentChat ||
          hydratedCurrentChat.id !== currentChatId ||
          hydratedCurrentChat.messages.length > 0
        ) {
          return;
        }

        useAIChatStore
          .getState()
          .setAcpRuntimeState(buildPiNativeRuntimeStateFromSession(latestSession), resolvedScopeId);

        const transcriptMessages = buildPiNativeChatMessagesFromTranscript(transcript);
        if (transcriptMessages.length > 0) {
          useAIChatStore.getState().replaceChatMessages(currentChatId, transcriptMessages);
        }

        if (hydratedCurrentChat.title === getDefaultChatTitle(surface)) {
          const nextTitle = derivePiNativeSessionTitle(latestSession);
          if (nextTitle !== hydratedCurrentChat.title) {
            useAIChatStore.getState().updateChatTitle(currentChatId, nextTitle);
          }
        }
      } catch (error) {
        console.error("Failed to reconcile pi-native Harness session", error);
      } finally {
        if (nativeSessionRestoreAttemptRef.current === restoreAttemptKey) {
          nativeSessionRestoreAttemptRef.current = null;
        }
      }
    };

    void reconcileNativeSession();
  }, [currentAgentId, currentChat, resolvedScopeId, rootFolderPath, runtimeBackend, surface]);

  return (
    <div
      data-ai-chat-surface={surface}
      className={cn(
        "ui-font flex h-full flex-col text-text text-xs",
        surface === "harness" ? "bg-primary-bg" : "bg-secondary-bg",
        className,
      )}
    >
      <ChatHeader surface={surface} scopeId={resolvedScopeId} />
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
          <div
            className={cn(
              "min-h-0 flex-1",
              surface === "harness" && "mx-auto flex w-full min-w-0 max-w-[1440px]",
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={cn(
                  "scrollbar-hidden relative z-0 flex-1 overflow-y-auto",
                  surface === "harness" && "px-3 pt-3 sm:px-4",
                )}
              >
                <div
                  className={cn(
                    surface === "harness" &&
                      "mx-auto flex min-h-full w-full max-w-[980px] flex-col",
                  )}
                >
                  <ChatMessages
                    ref={messagesEndRef}
                    onApplyCode={onApplyCode}
                    acpEvents={acpEvents}
                    surface={surface}
                    scopeId={resolvedScopeId}
                  />
                </div>
              </div>

              {currentPermission && (
                <div
                  className={cn(
                    "bg-transparent pt-2 text-xs",
                    surface === "harness" ? "px-3 sm:px-4" : "px-3",
                  )}
                >
                  <div className={cn(surface === "harness" && "mx-auto w-full max-w-[980px]")}>
                    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-primary-bg/90 px-3 py-2 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-text-lighter">permission:</span>
                        <span
                          className="min-w-0 flex-1 truncate text-text"
                          title={`${currentPermission.permissionType} • ${currentPermission.resource}`}
                        >
                          {currentPermission.description}
                        </span>
                      </div>

                      {currentPermission.permissionType === "input" ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={permissionValue}
                            onChange={(event) => setPermissionValue(event.target.value)}
                            placeholder={currentPermission.placeholder ?? "Enter value"}
                            className="min-w-0 flex-1 rounded-full border border-border bg-secondary-bg/80 px-3 py-1 text-text outline-none"
                          />
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handlePermission(false, true)}
                              className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text-lighter hover:bg-hover"
                            >
                              cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePermission(true, false, permissionValue)}
                              className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text hover:bg-hover"
                            >
                              submit
                            </button>
                          </div>
                        </div>
                      ) : currentPermission.permissionType === "select" ? (
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={currentPermission.title ?? "Selection request"}
                            value={permissionValue}
                            onChange={(event) => setPermissionValue(event.target.value)}
                            className="min-w-0 flex-1 rounded-full border border-border bg-secondary-bg/80 px-3 py-1 text-text outline-none"
                          >
                            {(currentPermission.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handlePermission(false, true)}
                              className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text-lighter hover:bg-hover"
                            >
                              cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePermission(true, false, permissionValue)}
                              className="rounded-full border border-border bg-secondary-bg/80 px-2.5 py-1 text-text hover:bg-hover"
                            >
                              choose
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center justify-end gap-1">
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
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!currentPermission && stalePermissions.length > 0 ? (
                <div
                  className={cn(
                    "bg-transparent pt-2 text-xs",
                    surface === "harness" ? "px-3 sm:px-4" : "px-3",
                  )}
                >
                  <div className={cn(surface === "harness" && "mx-auto w-full max-w-[980px]")}>
                    <div className="rounded-2xl border border-border bg-primary-bg/90 px-3 py-2 text-text-lighter">
                      {stalePermissions.length} permission request
                      {stalePermissions.length === 1 ? "" : "s"} expired when the ACP session reset.
                      Re-run the prompt to request permission again.
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={cn(surface === "harness" && "px-3 sm:px-4")}>
                <div className={cn(surface === "harness" && "mx-auto w-full max-w-[980px]")}>
                  <AIChatInputBar
                    buffers={buffers}
                    allProjectFiles={allProjectFiles}
                    surface={surface}
                    scopeId={resolvedScopeId}
                    harnessStatus={surface === "harness" ? harnessTrustState : null}
                    onSendMessage={handleSendMessage}
                    onStopStreaming={stopStreaming}
                  />
                </div>
              </div>
            </div>

            {surface === "harness" ? (
              <div className="hidden xl:flex xl:w-[320px] xl:shrink-0 xl:border-border/70 xl:border-l">
                <HarnessSessionRail
                  sessions={harnessSessions}
                  activeSession={{ status: harnessTrustState }}
                  recentRuntimeSessions={recentPiNativeRailSessions}
                  onCreateSession={handleCreateHarnessSession}
                  canReopenClosedSession={hasClosedHarnessSession}
                  onReopenClosedSession={handleReopenClosedHarnessSession}
                  onSelectSession={handleSelectHarnessSession}
                  onCloseSession={handleCloseHarnessSession}
                  onOpenRuntimeSession={handleOpenRecentPiNativeSession}
                />
              </div>
            ) : null}
          </div>

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
            chats={scopedChats}
            currentChatId={chatState.currentChatId}
            onContinueToChat={handleContinueChatFromHistory}
            onForkChat={handleForkChatFromHistory}
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

import { listen } from "@tauri-apps/api/event";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appendChatAcpEvent, type ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import {
  isAcpAuthenticationError,
  isAcpConfigurationError,
} from "@/features/ai/lib/acp-authentication";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import {
  appendReferencedFiles,
  loadFilesByPaths,
  parseMentionsAndLoadFiles,
} from "@/features/ai/lib/file-mentions";
import { extractFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import { buildConversationHistory } from "@/features/ai/lib/conversation-history";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { startAssistantResponseContinuation } from "@/features/ai/lib/assistant-response";
import {
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { getChatCompletionStream, isAcpAgent } from "@/features/ai/services/ai-chat-service";
import {
  sendAgentNativeNotification,
  type AgentNativeNotificationKind,
} from "@/features/ai/services/agent-native-notifications";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import { peekAgentDraft } from "@/features/ai/detached/agent-window-drafts";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type {
  AgentMessageSubmitResult,
  AIChatProps,
  Message,
} from "@/features/ai/types/ai-chat.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import {
  getFallbackAgentSessionTitle,
  normalizeAgentSessionTitle,
} from "@/features/ai/utils/chat-session-title";
import { getMessageSearchMatches } from "@/features/ai/utils/message-search";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { recordFrictionSignal } from "@/features/telemetry/services/telemetry";
import { claimContextualTip } from "@/features/onboarding/lib/contextual-teaching";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { getAccountIdentity } from "@/features/window/lib/account-identity";
import { useAgentWindowStore } from "@/features/ai/detached/agent-window.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/ui/message-scroller";
import { cn } from "@/utils/cn";
import { AgentStartView } from "../agent-start-view";
import { useChatActions, useChatState } from "../../hooks/use-chat-store";
import AIChatInputBar from "../input/chat-input-bar";
import { AcpPermissionPrompt, type AcpPermissionRequest } from "./acp-permission-prompt";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";

const createMessageId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
  const user = useAuthStore((state) => state.user);
  const githubAccountStatus = useGitHubStore((state) => state.githubAccountStatus);
  const githubCurrentUser = useGitHubStore((state) => state.currentUser);
  const enterprisePolicy = subscription?.enterprise?.policy;
  const isAiChatBlockedByPolicy = Boolean(
    enterprisePolicy?.managedMode && !enterprisePolicy.aiChatEnabled,
  );

  const chatState = useChatState();
  const chatActions = useChatActions();
  const { showToast } = useToast();

  const abortControllerRef = useRef<AbortController | null>(null);
  const [permissionQueue, setPermissionQueue] = useState<AcpPermissionRequest[]>([]);
  const [acpEvents, setAcpEvents] = useState<ChatAcpEvent[]>([]);
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [activeMessageSearchIndex, setActiveMessageSearchIndex] = useState(0);
  const composerContext = useComposerContextSelection(peekAgentDraft(surfaceId));
  const { selectedBufferIds, selectedEditorContexts, selectedFilesPaths } =
    composerContext.inputProps;
  const effectiveChatId = chatId ?? chatState.currentChatId;
  const previousChatId = useRef(effectiveChatId);
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === effectiveChatId),
    [chatState.chats, effectiveChatId],
  );
  const currentAgentId = currentChat?.agentId ?? useAIChatStore.getState().selectedAgentId;
  const assistantIconId =
    currentAgentId === "custom" ? (currentChat?.providerId ?? aiProviderId) : currentAgentId;
  const assistantLabel =
    currentAgentId === "custom"
      ? (currentChat?.modelId ?? currentChat?.providerId ?? aiProviderId)
      : currentAgentId;
  const connectedGitHubLogin =
    githubAccountStatus === "connected" ? githubCurrentUser || user?.github_username : null;
  const detachedIdentity = useAgentWindowStore((state) => state.accountIdentity);
  const accountIdentity = detachedIdentity ?? getAccountIdentity(user, connectedGitHubLogin);
  const activeRun = effectiveChatId ? chatState.agentRuns[effectiveChatId] : undefined;
  const isSurfaceTyping = Boolean(activeRun);
  const surfaceStreamingMessageId = activeRun?.assistantMessageId ?? null;
  const queuedMessages = effectiveChatId
    ? (chatState.agentMessageQueues[effectiveChatId] ?? [])
    : [];
  const chatMessageLoadState = effectiveChatId
    ? chatState.chatMessageLoadStates[effectiveChatId]
    : "loaded";
  const isChatMessagesLoaded = !effectiveChatId || chatMessageLoadState === "loaded";
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
    if (previousChatId.current !== effectiveChatId) composerContext.clear();
    previousChatId.current = effectiveChatId;
  }, [closeMessageSearch, composerContext.clear, effectiveChatId]);

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
        const { actions } = store;

        switch (payload.type) {
          case "slash_commands_update":
            actions.setAvailableSlashCommands(payload.commands);
            break;
          case "session_mode_update":
            actions.setSessionModeState(
              payload.modeState.currentModeId,
              payload.modeState.availableModes,
            );
            break;
          case "current_mode_update":
            actions.setCurrentModeId(payload.currentModeId);
            break;
          case "config_options_update":
            actions.setSessionConfigOptions(payload.configOptions);
            break;
          case "session_info_update": {
            const chat =
              store.chats.find((item) => item.acpSessionId === payload.sessionId) ??
              (store.acpStatus?.sessionId === payload.sessionId ? actions.getCurrentChat() : null);
            const nextTitle = chat ? getChatTitleFromSessionInfo(chat.title, payload.title) : null;
            if (chat && nextTitle) {
              actions.updateChatTitle(chat.id, nextTitle);
            }
            break;
          }
          case "status_changed":
            actions.setAcpStatus(payload.status);
            if (!payload.status.running) {
              actions.setAvailableSlashCommands([]);
              actions.setSessionModeState(null, []);
              actions.setSessionConfigOptions([]);
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

  const handleDeleteChat = (chatId: string) => {
    chatActions.deleteChat(chatId);
  };

  const updateInitialAgentSessionTitle = useCallback(
    async (chatId: string, userMessage: string) => {
      const fallbackTitle = getFallbackAgentSessionTitle(userMessage);
      chatActions.updateChatTitle(chatId, fallbackTitle);

      const authState = useAuthStore.getState();
      const enterprisePolicy = authState.subscription?.enterprise?.policy;
      const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
      const hasIntelligence = hasProductCapability(authState.subscription, "intelligence");

      if (!hasIntelligence || (managedPolicy && !managedPolicy.aiCompletionEnabled)) {
        return;
      }

      const model = useSettingsStore.getState().settings.aiAutocompleteModelId;
      if (!model) return;

      try {
        const { editedText } = await requestInlineEdit(
          {
            model,
            feature: "chat-title",
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

        const currentChat = useAIChatStore.getState().actions.getChatById(chatId);
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
      editorSelections: selectedEditorContexts,
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
    void recordFrictionSignal({ area: "agent", signal: "cancel" });
    const pendingPermissions = permissionQueue;
    setPermissionQueue([]);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const run = effectiveChatId ? useAIChatStore.getState().agentRuns[effectiveChatId] : undefined;

    if (currentAgentId === CODEX_INTEGRATION_ID) {
      try {
        await CodexIntegrationService.cancel();
        await Promise.all(
          pendingPermissions.map((item) => CodexIntegrationService.respond(item.requestId, false)),
        );
      } catch (error) {
        console.error("Failed to cancel Codex turn:", error);
      }
    } else if (isAcpAgent(currentAgentId)) {
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
    if (effectiveChatId && run) {
      finishRunAndProcessQueue(effectiveChatId, run.runId);
    }
  };

  const updateStreamingAssistantMessage = useCallback(
    (
      chatId: string,
      messageId: string,
      mutate: (currentMessage: Message | undefined) => Partial<Message>,
    ) => {
      const currentMessages = useAIChatStore.getState().actions.getMessagesForChat(chatId);
      const currentMessage = currentMessages.find((message) => message.id === messageId);
      chatActions.updateMessage(chatId, messageId, mutate(currentMessage));
    },
    [chatActions.updateMessage],
  );

  function finishRunAndProcessQueue(targetChatId: string, runId: string) {
    const actions = useAIChatStore.getState().actions;
    actions.finishAgentRun(targetChatId, runId);
    const nextMessage = actions.dequeueAgentMessage(targetChatId);
    if (nextMessage) {
      queueMicrotask(() => void processMessage(nextMessage, { targetChatId }));
    }
  }

  async function processMessage(
    messageContent: string,
    options: { editedUserMessageId?: string; targetChatId?: string } = {},
  ) {
    const store = useAIChatStore.getState();
    const requestedChatId = options.targetChatId ?? effectiveChatId;
    if (agentIsDetached(requestedChatId)) return;
    const targetChat = requestedChatId
      ? store.chats.find((chat) => chat.id === requestedChatId)
      : null;
    const currentAgentId = targetChat?.agentId ?? store.actions.getCurrentAgentId();
    const trimmedMessageContent = messageContent.trim();
    const access = getAgentMessageAccess(currentAgentId, store.hasApiKey);
    if (!trimmedMessageContent) return;
    if (!access.accepted) {
      showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
      return;
    }
    const isAcp = isAcpAgent(currentAgentId);
    // Agents are started automatically by AcpStreamHandler when needed

    let targetChatId = requestedChatId ?? store.currentChatId;
    if (!targetChatId) {
      targetChatId = chatActions.createNewChat(currentAgentId);
    } else {
      targetChatId = chatActions.ensureChatSession(targetChatId, currentAgentId, {
        activate: !chatId,
      });
    }

    const existingMessages = useAIChatStore.getState().actions.getMessagesForChat(targetChatId);
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
            id: createMessageId(),
            content: trimmedMessageContent,
            role: "user",
            timestamp: new Date(),
          };

    const assistantMessageId = createMessageId();
    const runId = createMessageId();
    const supportsAgentNotifications = isAcp || currentAgentId === CODEX_INTEGRATION_ID;
    const notifyAgent = (
      kind: AgentNativeNotificationKind,
      dedupeId: string = assistantMessageId,
    ) => {
      if (!supportsAgentNotifications) return;
      void sendAgentNativeNotification({
        kind,
        dedupeId: `${targetChatId}:${dedupeId}`,
        chatId: targetChatId,
      });
    };
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: "",
      role: "assistant",
      timestamp: new Date(),
      isStreaming: true,
      responsePhase: "starting",
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
    chatActions.startAgentRun(targetChatId, {
      runId,
      assistantMessageId,
      agentId: currentAgentId,
      phase: "starting",
    });

    const currentMessages = useAIChatStore.getState().actions.getMessagesForChat(targetChatId);
    if (currentMessages.length === 2) {
      void updateInitialAgentSessionTitle(targetChatId, userMessage.content);
    }

    abortControllerRef.current = new AbortController();
    const currentAssistantMessageId = assistantMessageId;
    let currentAssistantRawContent = "";
    let acpProducedStateOnlyUpdate = false;
    let acpCommandResultLabel: string | null = null;

    try {
      const { mentionedFiles } = await parseMentionsAndLoadFiles(
        trimmedMessageContent,
        allProjectFiles,
      );
      const mentionedPaths = new Set(mentionedFiles.map((file) => file.path));
      const attachedFiles = isAcp
        ? []
        : await loadFilesByPaths(
            Array.from(selectedFilesPaths).filter((path) => !mentionedPaths.has(path)),
          );
      const latestSettings = useSettingsStore.getState().settings;
      const context = await buildContext(currentAgentId, latestSettings.aiProviderId);
      context.mentionedFiles = [...mentionedFiles, ...attachedFiles];

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
              finishRunAndProcessQueue(targetChatId, runId);
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

          finishRunAndProcessQueue(targetChatId, runId);
          abortControllerRef.current = null;
          return;
        }
      }

      const enhancedMessage = isAcp
        ? trimmedMessageContent
        : appendReferencedFiles(trimmedMessageContent, [...mentionedFiles, ...attachedFiles]);
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
            responsePhase: undefined,
          }));
        },
        (completion) => {
          const wasCancelled = completion?.outcome === "cancelled";
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
              finishRunAndProcessQueue(targetChatId, runId);
              abortControllerRef.current = null;
              if (!wasCancelled) notifyAgent("complete");
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
            finishRunAndProcessQueue(targetChatId, runId);
            abortControllerRef.current = null;
            if (!wasCancelled) notifyAgent("error");
            return;
          }

          chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
            isStreaming: false,
          });
          finishRunAndProcessQueue(targetChatId, runId);
          abortControllerRef.current = null;
          if (!wasCancelled) notifyAgent("complete");
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

          const isAcpConfigError =
            isAcpAgent(currentAgentId) && isAcpConfigurationError(mainError, errorDetails);
          const isAcpAuthError =
            !isAcpConfigError &&
            isAcpAgent(currentAgentId) &&
            isAcpAuthenticationError(mainError, errorDetails);

          if (isAcpConfigError) {
            errorTitle = "Agent Configuration Required";
            errorCode = "CONFIG_REQUIRED";
            errorMessage =
              "The selected agent is authenticated, but its account configuration is incomplete.";
          } else if (isAcpAuthError) {
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
          notifyAgent("error");
          finishRunAndProcessQueue(targetChatId, runId);
          abortControllerRef.current = null;
        },
        conversationContext,
        () => {
          currentAssistantRawContent = startAssistantResponseContinuation(
            currentAssistantRawContent,
          );
          chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
            isStreaming: true,
            responsePhase: "waiting",
          });
          chatActions.updateAgentRun(targetChatId, runId, {
            assistantMessageId: currentAssistantMessageId,
            phase: "waiting",
          });
        },
        (event) => {
          chatActions.updateAgentRun(targetChatId, runId, { phase: "tool" });
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
          chatActions.updateAgentRun(targetChatId, runId, { phase: "approval" });
          notifyAgent("permission", event.requestId);
          appendAcpEvent({
            id: `permission-request-${event.requestId}`,
            category: "permission",
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
          if (!isAcpAgent(currentAgentId) && currentAgentId !== CODEX_INTEGRATION_ID) return;
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
              chatActions.updateAgentRun(targetChatId, runId, { phase: "thinking" });
              updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
                responsePhase: "thinking",
              }));
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
                  category: "status",
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
                category: "plan",
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
              useAIChatStore.getState().actions.setAcpStatus(event.status);
              break; // internal state sync
            case "error":
              appendAcpEvent({
                category: "error",
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
      finishRunAndProcessQueue(targetChatId, runId);
      abortControllerRef.current = null;
    }
  }

  const sendMessage = useCallback(
    (messageContent: string): AgentMessageSubmitResult => {
      if (agentIsDetached(effectiveChatId))
        return { accepted: false, error: "This agent is open in another window." };
      if (!messageContent.trim()) return { accepted: false };
      const access = getAgentMessageAccess(currentAgentId, chatState.hasApiKey);
      if (!access.accepted) {
        showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
        return access;
      }
      if (!isChatMessagesLoaded) {
        const result = { accepted: false, error: "Wait for this session to finish loading." };
        showToast({ message: result.error, type: "error" });
        return result;
      }

      const targetChatId = effectiveChatId ?? useAIChatStore.getState().currentChatId;
      if (targetChatId && useAIChatStore.getState().agentRuns[targetChatId]) {
        chatActions.enqueueAgentMessage(targetChatId, messageContent);
        if (claimContextualTip("agent-queue-controls")) {
          showToast({
            message: "Message queued",
            description:
              "Open the queue to edit, reorder, or remove guidance while the agent runs.",
            type: "info",
          });
        }
        return { accepted: true };
      }

      void processMessage(messageContent);
      return { accepted: true };
    },
    [
      chatActions.enqueueAgentMessage,
      chatState.hasApiKey,
      currentAgentId,
      effectiveChatId,
      isChatMessagesLoaded,
      showToast,
    ],
  );

  const handleSendMessage = useCallback(
    (messageContent: string) => sendMessage(messageContent),
    [sendMessage],
  );

  const handleSendFollowUp = useCallback(
    (messageContent: string) => {
      sendMessage(messageContent);
    },
    [sendMessage],
  );

  const handleInterruptAndSend = useCallback(
    (messageContent: string): AgentMessageSubmitResult => {
      if (!messageContent.trim()) return { accepted: false };
      const access = getAgentMessageAccess(currentAgentId, chatState.hasApiKey);
      if (!access.accepted) {
        showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
        return access;
      }

      const targetChatId = effectiveChatId ?? useAIChatStore.getState().currentChatId;
      if (!targetChatId || !useAIChatStore.getState().agentRuns[targetChatId]) {
        return sendMessage(messageContent);
      }

      chatActions.prependAgentMessage(targetChatId, messageContent);
      void stopStreaming();
      return { accepted: true };
    },
    [
      chatActions.prependAgentMessage,
      chatState.hasApiKey,
      currentAgentId,
      effectiveChatId,
      sendMessage,
      showToast,
    ],
  );

  const processMessageRef = useRef(processMessage);
  useLayoutEffect(() => {
    processMessageRef.current = processMessage;
  });

  const handleEditUserMessage = useCallback(
    (messageId: string, content: string) => {
      if (isSurfaceTyping || surfaceStreamingMessageId) return;
      void processMessageRef.current(content, { editedUserMessageId: messageId });
    },
    [isSurfaceTyping, surfaceStreamingMessageId],
  );

  useEffect(() => {
    const pendingLaunch = chatState.pendingAgentLaunchRequest;
    if (!pendingLaunch) return;
    if (pendingLaunch.chatId !== effectiveChatId) return;
    if (activeBuffer?.type !== "agent") return;
    if (activeBuffer.sessionId !== pendingLaunch.chatId) return;
    if (isSurfaceTyping || surfaceStreamingMessageId) return;
    composerContext.replace(
      pendingLaunch.selectedBufferIds,
      pendingLaunch.selectedFilesPaths,
      pendingLaunch.editorSelections,
    );
    chatActions.setPendingAgentLaunchRequest(null);
    if (!pendingLaunch.prompt) return;

    const access = getAgentMessageAccess(pendingLaunch.agentId, chatState.hasApiKey);
    if (!access.accepted) {
      showToast({ message: access.error ?? "This agent is not ready.", type: "error" });
      return;
    }

    void sendMessage(pendingLaunch.prompt);
  }, [
    chatActions,
    effectiveChatId,
    chatState.hasApiKey,
    isSurfaceTyping,
    chatState.pendingAgentLaunchRequest,
    surfaceStreamingMessageId,
    activeBuffer,
    composerContext.replace,
    sendMessage,
    showToast,
  ]);

  const currentPermission = permissionQueue[0];
  const isNewSession =
    isChatMessagesLoaded && (currentChat?.messages.length ?? 0) === 0 && acpEvents.length === 0;
  const useInitialComposer = isNewSession && !currentPermission;
  const handlePermission = async (approved: boolean, optionId?: string) => {
    if (!currentPermission) return;
    try {
      const option = currentPermission.options.find((item) => item.id === optionId);
      appendAcpEvent({
        id: `permission-response-${currentPermission.requestId}`,
        category: "permission",
        label: "Permission response",
        detail: option?.name || (approved ? "allow" : "deny"),
        state: approved ? "success" : "info",
      });
      if (currentAgentId === CODEX_INTEGRATION_ID) {
        await CodexIntegrationService.respond(currentPermission.requestId, approved);
      } else {
        await AcpStreamHandler.respondToPermission(
          currentPermission.requestId,
          approved,
          false,
          optionId,
        );
      }
    } finally {
      setPermissionQueue((prev) => prev.slice(1));
    }
  };

  const composer = (
    <AIChatInputBar
      key={effectiveChatId ?? "new-session"}
      surfaceId={surfaceId}
      buffers={buffers}
      allProjectFiles={allProjectFiles}
      currentAgentId={currentAgentId}
      isTyping={isSurfaceTyping}
      streamingMessageId={surfaceStreamingMessageId}
      queuedMessages={queuedMessages}
      {...composerContext.inputProps}
      isActiveSurface={isActiveSurface}
      presentation={useInitialComposer ? "initial" : "default"}
      onSendMessage={handleSendMessage}
      onInterruptAndSend={handleInterruptAndSend}
      onMoveQueuedMessage={(fromIndex, toIndex) => {
        if (effectiveChatId)
          chatActions.moveQueuedAgentMessage(effectiveChatId, fromIndex, toIndex);
      }}
      onRemoveQueuedMessage={(index, reason) => {
        if (effectiveChatId) {
          chatActions.removeQueuedAgentMessage(effectiveChatId, index);
          if (reason === "discard") {
            void recordFrictionSignal({ area: "agent", signal: "queue_discard" });
          }
        }
      }}
      onStopStreaming={stopStreaming}
    />
  );

  return (
    <div
      className={cn(
        "font-sans flex h-full select-none flex-col bg-transparent text-foreground selection:bg-selection selection:text-foreground ui-text-sm",
        className,
      )}
    >
      <ChatHeader
        chatId={effectiveChatId}
        onDeleteChat={handleDeleteChat}
        onSwitchChat={chatId ? openAgentHistoryChat : chatActions.switchToChat}
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
        <Empty className="h-full rounded-none p-6">
          <EmptyHeader>
            <EmptyTitle>Agent is disabled</EmptyTitle>
            <EmptyDescription>
              Your organization policy has disabled Agent for this workspace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !isChatMessagesLoaded ? (
        <Empty className="h-full rounded-none p-6">
          <EmptyHeader>
            <EmptyTitle>
              {chatMessageLoadState === "error"
                ? "Session could not be loaded"
                : "Loading session…"}
            </EmptyTitle>
            {chatMessageLoadState === "error" ? (
              <EmptyDescription>Close and reopen this session to try again.</EmptyDescription>
            ) : null}
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {useInitialComposer ? (
            <AgentStartView>{composer}</AgentStartView>
          ) : (
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
              <MessageScroller>
                <MessageScrollerViewport fadeEdges>
                  <ChatMessages
                    surfaceId={surfaceId}
                    chatId={effectiveChatId}
                    onApplyCode={onApplyCode}
                    onSendFollowUp={handleSendFollowUp}
                    onEditUserMessage={handleEditUserMessage}
                    canEditUserMessages={
                      getAgentMessageAccess(currentAgentId, chatState.hasApiKey).accepted &&
                      !isSurfaceTyping &&
                      !surfaceStreamingMessageId &&
                      !isAiChatBlockedByPolicy
                    }
                    acpEvents={acpEvents}
                    searchQuery={messageSearchQuery}
                    activeSearchMessageId={activeMessageSearchMatch?.messageId ?? null}
                    activeSearchIndex={activeMessageSearchIndex}
                    userName={accountIdentity.name}
                    userAvatarUrl={accountIdentity.avatarUrl}
                    assistantIconId={assistantIconId}
                    assistantLabel={assistantLabel}
                  />
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}

          {currentPermission ? (
            <AcpPermissionPrompt
              permission={currentPermission}
              queuedCount={permissionQueue.length - 1}
              onRespond={handlePermission}
            />
          ) : null}

          {!useInitialComposer ? composer : null}
        </>
      )}
    </div>
  );
});

export default AIChat;

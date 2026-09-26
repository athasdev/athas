import { getApiErrorCode } from "@/features/ai/lib/api-error";
import { cancelIntelligenceAgent } from "@/features/ai/intelligence/services/intelligence-agent-session";
import { getProviderAccessFromMap } from "@/features/ai/stores/ai-chat/provider-actions";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { openTerminalAgent } from "@/features/ai/lib/terminal-agent-terminal";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appendChatAcpEvent, type ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import { acpNoticeToChatEvent } from "@/features/ai/lib/acp-notices";
import {
  isAcpAuthenticationError,
  isAcpConfigurationError,
} from "@/features/ai/lib/acp-authentication";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import {
  appendReferencedFiles,
  loadFilesByPaths,
  parseMentionsAndLoadFiles,
} from "@/features/ai/lib/file-mentions";
import { extractFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import { getAgentStopNotice } from "@/features/ai/lib/agent-stop-notice";
import { buildConversationHistory } from "@/features/ai/lib/conversation-history";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import {
  discardToolEditSnapshot,
  resolveToolEditDiff,
  snapshotToolEdit,
} from "@/features/ai/lib/edit-diff-capture";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { startAssistantResponseContinuation } from "@/features/ai/lib/assistant-response";
import { claimRunAbortController } from "@/features/ai/lib/run-abort-controller";
import {
  beginQueuedSendNow,
  setQueuedMessageEditing,
  settleQueuedSendNow,
} from "@/features/ai/lib/agent-queue-controls";
import {
  cancelUnfinishedToolCalls,
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";
import { followAgentLocations, followAgentTo } from "@/features/ai/services/agent-follow-service";
import { recordAgentFileWrite } from "@/features/ai/services/agent-edits-service";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { getChatCompletionStream, isAcpAgent } from "@/features/ai/services/ai-chat-service";
import type {
  ImageContent,
  QueuedAgentMessage,
  RestoredComposerPrompt,
} from "@/features/ai/types/ai-chat.types";
import {
  type AgentRunEnding,
  continuesAgentQueue,
  getAgentRunEnding,
} from "@/features/ai/lib/agent-message-queue";
import {
  sendAgentNativeNotification,
  type AgentNativeNotificationKind,
} from "@/features/ai/services/agent-native-notifications";
import { useAcpNoticesStore } from "@/features/ai/stores/acp-notices.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import { peekAgentDraft } from "@/features/ai/detached/agent-window-drafts";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
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
import {
  selectSessionQuestions,
  useAcpQuestionsStore,
} from "@/features/ai/stores/acp-questions.store";
import type { AcpElicitationResponse } from "@/features/ai/lib/acp-elicitation";
import { AcpPermissionPrompt } from "./acp-permission-prompt";
import { markAgentChatVisible } from "@/features/ai/lib/visible-agent-chats";
import {
  selectChatPermissions,
  useAgentPermissionsStore,
} from "@/features/ai/stores/agent-permissions.store";
import { getAcpPermissionPreview } from "@/features/ai/lib/acp-permission-preview";
import { AcpQuestionPrompt } from "./acp-question-prompt";
import { AcpUrlQuestionPrompt } from "./acp-url-question-prompt";
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
  const allPermissions = useAgentPermissionsStore.use.permissions();
  const permissionActions = useAgentPermissionsStore.use.actions();
  const allAgentQuestions = useAcpQuestionsStore.use.questions();
  const questionActions = useAcpQuestionsStore.use.actions();
  const [acpEvents, setAcpEvents] = useState<ChatAcpEvent[]>([]);
  const [refusedPrompt, setRefusedPrompt] = useState<RestoredComposerPrompt | null>(null);
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [activeMessageSearchIndex, setActiveMessageSearchIndex] = useState(0);
  const composerContext = useComposerContextSelection(peekAgentDraft(surfaceId));
  const { selectedBufferIds, selectedEditorContexts, selectedFilesPaths } =
    composerContext.inputProps;
  const effectiveChatId = chatId ?? chatState.currentChatId;
  const previousChatId = useRef(effectiveChatId);
  useEffect(() => {
    if (!effectiveChatId) return;
    return markAgentChatVisible(effectiveChatId);
  }, [effectiveChatId]);
  const currentChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === effectiveChatId),
    [chatState.chats, effectiveChatId],
  );
  const currentAgentId = currentChat?.agentId ?? chatState.selectedAgentId;
  const chatSessionId = currentChat?.acpSessionId ?? null;
  const sessionNotices = useAcpNoticesStore((state) =>
    chatSessionId ? state.notices[chatSessionId] : undefined,
  );
  const permissionQueue = useMemo(
    () => selectChatPermissions(allPermissions, effectiveChatId),
    [allPermissions, effectiveChatId],
  );
  const agentQuestions = useMemo(
    () => selectSessionQuestions(allAgentQuestions, chatSessionId),
    [allAgentQuestions, chatSessionId],
  );
  const sessionProviderId = currentChat?.providerId ?? aiProviderId;
  const hasSessionApiKey = useAIChatStore((state) =>
    getProviderAccessFromMap(sessionProviderId, state.providerApiKeys),
  );
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
    if (currentAgentId === "custom") void chatActions.checkApiKey(sessionProviderId);
  }, [currentAgentId, sessionProviderId, subscription, chatActions.checkApiKey]);

  // A surface can be handed a history row that nothing has fetched yet (a
  // restored tab, a reused empty session). Ask for it instead of waiting.
  useEffect(() => {
    if (!effectiveChatId || !currentChat || chatMessageLoadState !== undefined) return;
    void useAIChatStore.getState().actions.loadChatMessages(effectiveChatId);
  }, [effectiveChatId, currentChat, chatMessageLoadState]);

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

      try {
        const { editedText } = await requestInlineEdit({
          model: "",
          feature: "chat-title",
          beforeSelection: "",
          selectedText: userMessage,
          afterSelection: "",
          instruction:
            "Name the software feature or task being worked on. Return exactly one or two words, no punctuation, no quotes, no explanation. Prefer a concrete product feature label over a generic verb.",
          filePath: "agent-session-title",
          languageId: "text",
        });

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

    const context: ContextInfo = {
      activeBuffer: selectedActiveBuffer,
      openBuffers: selectedBuffers,
      selectedFiles,
      selectedProjectFiles: Array.from(selectedFilesPaths),
      editorSelections: selectedEditorContexts,
      projectRoot: rootFolderPath,
      providerId,
      agentId,
    };

    if (selectedActiveBuffer) {
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

  const stopStreaming = async (options: { continueQueue?: boolean } = {}) => {
    void recordFrictionSignal({ area: "agent", signal: "cancel" });
    // ACP and Athas's own agent close their prompts on cancel; Codex prompts are refused.
    const refusedCodexPermissions = effectiveChatId
      ? permissionActions.dropStoppedTurn(effectiveChatId)
      : Promise.resolve();
    questionActions.forgetWaitingForSession(chatSessionId);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const run = effectiveChatId ? useAIChatStore.getState().agentRuns[effectiveChatId] : undefined;

    if (currentAgentId === "custom" && effectiveChatId) {
      cancelIntelligenceAgent(effectiveChatId);
    } else if (currentAgentId === CODEX_INTEGRATION_ID) {
      try {
        await CodexIntegrationService.cancel();
        await refusedCodexPermissions;
      } catch (error) {
        console.error("Failed to cancel Codex turn:", error);
      }
    } else if (isAcpAgent(currentAgentId)) {
      // The bridge answers the turn's open permission requests and questions as cancelled.
      await AcpStreamHandler.cancelPrompt(effectiveChatId);
    }
    if (effectiveChatId && run) {
      // Stop means stop: queued follow-ups stay queued instead of launching.
      if (options.continueQueue) {
        finishRunAndProcessQueue(effectiveChatId, run.runId, "interrupted");
      } else {
        useAIChatStore.getState().actions.finishAgentRun(effectiveChatId, run.runId);
      }
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

  function finishRunAndProcessQueue(
    targetChatId: string,
    runId: string,
    ending: AgentRunEnding = "completed",
  ) {
    // A "Send now" that stopped this turn has its prompt starting now.
    settleQueuedSendNow(targetChatId);
    if (useAIChatStore.getState().agentRuns[targetChatId]?.runId !== runId) return;
    const actions = useAIChatStore.getState().actions;
    actions.finishAgentRun(targetChatId, runId);
    if (!continuesAgentQueue(ending)) return;
    const nextMessage = actions.dequeueAgentMessage(targetChatId);
    if (nextMessage) {
      queueMicrotask(
        () =>
          void processMessage(nextMessage.content, { targetChatId, images: nextMessage.images }),
      );
    }
  }

  async function processMessage(
    messageContent: string,
    options: { editedUserMessageId?: string; targetChatId?: string; images?: ImageContent[] } = {},
  ) {
    const store = useAIChatStore.getState();
    const requestedChatId = options.targetChatId ?? effectiveChatId;
    if (agentIsDetached(requestedChatId)) return;
    const targetChat = requestedChatId
      ? store.chats.find((chat) => chat.id === requestedChatId)
      : null;
    const currentAgentId = targetChat?.agentId ?? store.actions.getCurrentAgentId();
    const trimmedMessageContent = messageContent.trim();
    const access = getAgentMessageAccess(
      currentAgentId,
      getProviderAccessFromMap(targetChat?.providerId ?? aiProviderId, store.providerApiKeys),
    );
    if (!trimmedMessageContent && !options.images?.length && !options.editedUserMessageId) return;
    if (!access.accepted) {
      showToast({
        message:
          currentAgentId === "custom" && (targetChat?.providerId ?? aiProviderId) === "athas"
            ? "Sign in and add Athas Agent balance to use hosted models."
            : (access.error ?? "This agent is not ready."),
        type: "error",
      });
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
            images: options.images,
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
      responsePhase: "waiting",
    };

    if (options.editedUserMessageId) {
      const didReplace = chatActions.replaceUserMessage(
        targetChatId,
        options.editedUserMessageId,
        trimmedMessageContent,
      );
      if (!didReplace) return;
      // The edited prompt was just re-stamped; its answer must come after it.
      assistantMessage.timestamp = new Date();
    } else {
      chatActions.addMessage(targetChatId, userMessage);
    }
    chatActions.addMessage(targetChatId, assistantMessage);
    chatActions.startAgentRun(targetChatId, {
      runId,
      assistantMessageId,
      agentId: currentAgentId,
      phase: "waiting",
    });

    const currentMessages = useAIChatStore.getState().actions.getMessagesForChat(targetChatId);
    if (currentMessages.length === 2) {
      void updateInitialAgentSessionTitle(targetChatId, userMessage.content);
    }

    // A stopped turn can finish after the next one started; it only clears its own controller.
    const { release: releaseAbortController } = claimRunAbortController(abortControllerRef);
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
      const settings = useSettingsStore.getState().settings;
      const latestSettings = {
        ...settings,
        aiProviderId: targetChat?.providerId ?? settings.aiProviderId,
        aiModelId: targetChat?.modelId ?? settings.aiModelId,
      };
      const context = await buildContext(currentAgentId, latestSettings.aiProviderId);
      context.images = userMessage.images;
      context.mentionedFiles = [...mentionedFiles, ...attachedFiles];

      // Handle direct ACP UI intents locally so they are always reliable.
      if (isAcp && !userMessage.images?.length) {
        const directAction = parseDirectAcpUiAction(trimmedMessageContent);
        if (directAction) {
          const bufferActions = useBufferStore.getState().actions;
          if (directAction.kind === "open_terminal" && directAction.command) {
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
          releaseAbortController();
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
          permissionActions.dropSettled(targetChatId);
          const wasCancelled = completion?.outcome === "cancelled";
          if (wasCancelled || (completion?.stopReason && completion.stopReason !== "end_turn")) {
            // The turn is over; a call the agent never finished must not stay running.
            updateStreamingAssistantMessage(
              targetChatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                toolCalls: cancelUnfinishedToolCalls(currentMessage?.toolCalls),
              }),
            );
          }
          const currentMessage = chatActions
            .getMessagesForChat(targetChatId)
            .find((message) => message.id === currentAssistantMessageId);
          const hasVisibleResponse = Boolean(
            currentMessage?.content?.trim() ||
            currentMessage?.toolCalls?.length ||
            currentMessage?.images?.length ||
            currentMessage?.resources?.length,
          );

          const stopNotice = wasCancelled
            ? undefined
            : getAgentStopNotice(completion?.stopReason, currentMessage);
          const turnUsage = completion?.usage;
          if (stopNotice) {
            updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
              stopNotice,
              turnUsage,
              isStreaming: false,
              responsePhase: undefined,
            }));
            if (stopNotice === "prompt_refused") {
              // The prompt was rejected; hand it back so the user can rephrase it.
              setRefusedPrompt({
                id: currentAssistantMessageId,
                content: userMessage.content,
                images: userMessage.images,
              });
            }
            finishRunAndProcessQueue(targetChatId, runId, getAgentRunEnding(false, stopNotice));
            releaseAbortController();
            notifyAgent(
              stopNotice === "prompt_refused" || stopNotice === "refused" ? "error" : "complete",
            );
            return;
          }

          if (!hasVisibleResponse && wasCancelled) {
            updateStreamingAssistantMessage(targetChatId, currentAssistantMessageId, () => ({
              content: "_Stopped._",
              isStreaming: false,
              responsePhase: undefined,
            }));
            finishRunAndProcessQueue(targetChatId, runId, "stopped");
            releaseAbortController();
            return;
          }

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
              finishRunAndProcessQueue(targetChatId, runId, getAgentRunEnding(wasCancelled));
              releaseAbortController();
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
            finishRunAndProcessQueue(targetChatId, runId, wasCancelled ? "stopped" : "failed");
            releaseAbortController();
            if (!wasCancelled) notifyAgent("error");
            return;
          }

          chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
            isStreaming: false,
            turnUsage,
          });
          finishRunAndProcessQueue(targetChatId, runId, getAgentRunEnding(wasCancelled));
          releaseAbortController();
          if (!wasCancelled) notifyAgent("complete");
        },
        (error: string, canReconnect?: boolean) => {
          permissionActions.dropSettled(targetChatId);
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

          errorCode = getApiErrorCode(mainError);
          if (errorCode) {
            if (errorCode === "429") {
              errorTitle = "Rate Limit Exceeded";
              errorMessage =
                "The API is temporarily rate-limited. Please wait a moment and try again.";
            } else if (errorCode === "401") {
              errorTitle = "Authentication Error";
              errorMessage =
                (targetChat?.providerId ?? settings.aiProviderId) === "athas"
                  ? "Your Athas session has expired. Sign in to continue."
                  : "The provider rejected your API key. Check its configuration to continue.";
            } else if (errorCode === "402") {
              errorTitle = "Payment required";
              errorMessage =
                "Check your balance and spending limits to continue, or choose another model.";
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

          if (errorDetails) {
            try {
              const parsed = JSON.parse(errorDetails);
              const detailMessage =
                parsed.error?.message ??
                (typeof parsed.error === "string" ? parsed.error : parsed.message);
              if (typeof detailMessage === "string") errorMessage = detailMessage;
            } catch {
              // Non-JSON provider responses remain available under Details.
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
provider: ${targetChat?.providerId ?? settings.aiProviderId}
message: ${errorMessage}
details: ${errorDetails || mainError}
[/ERROR_BLOCK]`;

          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              content: currentMessage?.content
                ? `${currentMessage.content}\n\n${formattedError}`
                : formattedError,
              toolCalls: cancelUnfinishedToolCalls(currentMessage?.toolCalls),
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
          finishRunAndProcessQueue(targetChatId, runId, "failed");
          releaseAbortController();
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
          const toolCall = createToolCall(
            event.toolName,
            event.input,
            event.toolId,
            event.kind,
            event.status,
            event.locations,
            event.output,
            event.rawOutput,
          );
          void snapshotToolEdit(toolCall);
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) => ({
              isToolUse: true,
              toolName: event.toolName,
              toolCalls: [
                ...(currentMessage?.toolCalls || []),
                { ...toolCall, contentOffset: (currentMessage?.content ?? "").length },
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
                rawOutput: event.rawOutput,
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
          const completed = chatActions
            .getMessagesForChat(targetChatId)
            .find((message) => message.id === currentAssistantMessageId)
            ?.toolCalls?.find((toolCall) =>
              toolId ? toolCall.id === toolId : toolCall.name === toolName && toolCall.isComplete,
            );
          if (!completed?.id || error) {
            discardToolEditSnapshot(completed?.id ?? toolId);
            return;
          }
          const completedId = completed.id;
          void resolveToolEditDiff(completed).then((nextOutput) => {
            if (!nextOutput) return;
            updateStreamingAssistantMessage(
              targetChatId,
              currentAssistantMessageId,
              (currentMessage) => ({
                toolCalls: updateToolCall(currentMessage?.toolCalls || [], {
                  id: completedId,
                  output: nextOutput,
                }),
              }),
            );
          });
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
          permissionActions.add({
            chatId: targetChatId,
            responder: event.requestId.startsWith("intelligence:")
              ? "intelligence"
              : currentAgentId === CODEX_INTEGRATION_ID
                ? "codex"
                : "acp",
            requestId: event.requestId,
            description: event.description,
            permissionType: event.permissionType,
            resource: event.resource,
            options: event.options,
            preview: getAcpPermissionPreview(event),
          });
        },
        (event) => {
          if (!isAcpAgent(currentAgentId) && currentAgentId !== CODEX_INTEGRATION_ID) return;
          if (event.type === "elicitation_request") {
            chatActions.updateAgentRun(targetChatId, runId, { phase: "approval" });
            notifyAgent("question", event.requestId);
            appendAcpEvent({
              id: `question-${event.requestId}`,
              category: "permission",
              label: "Question asked",
              detail: event.request.message,
              state: "info",
            });
            return;
          }
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
              followAgentLocations(targetChatId, event.locations);
              break;
            case "agent_location":
              followAgentTo(targetChatId, { path: event.path, line: event.line });
              break;
            case "agent_file_write":
              recordAgentFileWrite(targetChatId, {
                path: event.path,
                previousContent: event.previousContent,
                content: event.content,
              });
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
            case "plan_update":
              // ACP sends the full plan each time; the message shows the latest one.
              chatActions.updateMessage(targetChatId, currentAssistantMessageId, {
                plan: event.entries.length > 0 ? event.entries : undefined,
              });
              break;
            case "usage_update":
              break; // The chat store keeps the session's usage
            case "status_changed":
              break; // The chat store follows agent status
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
        undefined,
        (phase) => {
          updateStreamingAssistantMessage(
            targetChatId,
            currentAssistantMessageId,
            (currentMessage) =>
              currentMessage?.isStreaming &&
              !currentMessage.content &&
              currentMessage.responsePhase !== "thinking"
                ? { responsePhase: phase }
                : {},
          );
        },
      );
    } catch (error) {
      console.error("Failed to start streaming:", error);
      chatActions.updateMessage(targetChatId, assistantMessageId, {
        content:
          "Error: Failed to connect to Agent service. Please check your API key and try again.",
        isStreaming: false,
      });
      finishRunAndProcessQueue(targetChatId, runId, "failed");
      releaseAbortController();
    }
  }

  const sendMessage = useCallback(
    (messageContent: string, images?: ImageContent[]): AgentMessageSubmitResult => {
      if (agentIsDetached(effectiveChatId))
        return { accepted: false, error: "This agent is open in another window." };
      if (!messageContent.trim() && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(currentAgentId, hasSessionApiKey);
      if (!access.accepted) {
        showToast({
          message:
            currentAgentId === "custom" && (currentChat?.providerId ?? aiProviderId) === "athas"
              ? "Sign in and add Athas Agent balance to use hosted models."
              : (access.error ?? "This agent is not ready."),
          type: "error",
        });
        return access;
      }
      if (!isChatMessagesLoaded) {
        const result = { accepted: false, error: "Wait for this session to finish loading." };
        showToast({ message: result.error, type: "error" });
        return result;
      }

      const targetChatId = effectiveChatId ?? useAIChatStore.getState().currentChatId;
      if (targetChatId && useAIChatStore.getState().agentRuns[targetChatId]) {
        chatActions.enqueueAgentMessage(targetChatId, messageContent, images);
        if (claimContextualTip("agent-queue-controls")) {
          showToast({
            message: "Message queued",
            description:
              "It sends when this turn ends. Edit, reorder, or send it now from the queue above.",
            type: "info",
          });
        }
        return { accepted: true };
      }

      void processMessage(messageContent, { images });
      return { accepted: true };
    },
    [
      chatActions.enqueueAgentMessage,
      hasSessionApiKey,
      aiProviderId,
      currentChat?.providerId,
      currentAgentId,
      effectiveChatId,
      isChatMessagesLoaded,
      showToast,
    ],
  );

  const handleSendMessage = useCallback(
    (messageContent: string, images?: ImageContent[]) => sendMessage(messageContent, images),
    [sendMessage],
  );

  const handleSendFollowUp = useCallback(
    (messageContent: string) => {
      sendMessage(messageContent);
    },
    [sendMessage],
  );

  const handleInterruptAndSend = useCallback(
    (messageContent: string, images?: ImageContent[]): AgentMessageSubmitResult => {
      if (agentIsDetached(effectiveChatId)) return { accepted: false };
      if (!messageContent.trim() && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(currentAgentId, hasSessionApiKey);
      if (!access.accepted) {
        showToast({
          message:
            currentAgentId === "custom" && (currentChat?.providerId ?? aiProviderId) === "athas"
              ? "Sign in and add Athas Agent balance to use hosted models."
              : (access.error ?? "This agent is not ready."),
          type: "error",
        });
        return access;
      }

      const targetChatId = effectiveChatId ?? useAIChatStore.getState().currentChatId;
      if (!targetChatId || !useAIChatStore.getState().agentRuns[targetChatId]) {
        return sendMessage(messageContent, images);
      }

      chatActions.prependAgentMessage(targetChatId, messageContent, images);
      void stopStreaming({ continueQueue: true });
      return { accepted: true };
    },
    [
      chatActions.prependAgentMessage,
      hasSessionApiKey,
      aiProviderId,
      currentChat?.providerId,
      currentAgentId,
      effectiveChatId,
      sendMessage,
      showToast,
    ],
  );

  const handleSendQueuedMessageNow = (index: number) => {
    if (!effectiveChatId || agentIsDetached(effectiveChatId)) return;
    const store = useAIChatStore.getState();
    const message = store.agentMessageQueues[effectiveChatId]?.[index];
    if (!message) return;
    // A quick second click must not reorder the queue or stop the turn the first one started.
    if (!beginQueuedSendNow(effectiveChatId)) return;
    if (store.agentRuns[effectiveChatId]) {
      // It runs next: the stopped turn winds down before this prompt starts.
      store.actions.moveQueuedAgentMessage(effectiveChatId, index, 0);
      void stopStreaming({ continueQueue: true });
      return;
    }
    // The queue is held after a stop, refusal or error; send this one on its own.
    if (sendMessage(message.content, message.images).accepted) {
      store.actions.removeQueuedAgentMessage(effectiveChatId, index);
    }
    settleQueuedSendNow(effectiveChatId);
  };

  const processMessageRef = useRef(processMessage);
  useLayoutEffect(() => {
    processMessageRef.current = processMessage;
  });

  const handleEditQueuedMessage = useCallback(
    (message: QueuedAgentMessage | null) => {
      if (!effectiveChatId) return;
      const resume = setQueuedMessageEditing(effectiveChatId, message);
      // The queue waited for this edit when the last turn ended; send the next message now.
      if (!resume || useAIChatStore.getState().agentRuns[effectiveChatId]) return;
      const next = useAIChatStore.getState().actions.dequeueAgentMessage(effectiveChatId);
      if (next) {
        void processMessageRef.current(next.content, {
          targetChatId: effectiveChatId,
          images: next.images,
        });
      }
    },
    [effectiveChatId],
  );

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
    if (!pendingLaunch.prompt && !pendingLaunch.images?.length) return;

    const access = getAgentMessageAccess(pendingLaunch.agentId, hasSessionApiKey);
    if (!access.accepted) {
      showToast({
        message:
          currentAgentId === "custom" && (currentChat?.providerId ?? aiProviderId) === "athas"
            ? "Sign in and add Athas Agent balance to use hosted models."
            : (access.error ?? "This agent is not ready."),
        type: "error",
      });
      return;
    }

    void sendMessage(pendingLaunch.prompt ?? "", pendingLaunch.images);
  }, [
    chatActions,
    effectiveChatId,
    hasSessionApiKey,
    aiProviderId,
    currentChat?.providerId,
    currentAgentId,
    isSurfaceTyping,
    chatState.pendingAgentLaunchRequest,
    surfaceStreamingMessageId,
    activeBuffer,
    composerContext.replace,
    sendMessage,
    showToast,
  ]);

  // Notices are live information from the agent, shown in the timeline but never saved.
  const timelineEvents = useMemo(
    () =>
      sessionNotices?.length
        ? [...acpEvents, ...sessionNotices.map(acpNoticeToChatEvent)]
        : acpEvents,
    [acpEvents, sessionNotices],
  );
  const currentPermission = permissionQueue[0];
  const isNewSession =
    isChatMessagesLoaded && (currentChat?.messages.length ?? 0) === 0 && acpEvents.length === 0;
  const currentQuestion = currentPermission ? undefined : agentQuestions[0];
  const useInitialComposer = isNewSession && !currentPermission && !currentQuestion;
  const handleQuestionAnswer = async (response: AcpElicitationResponse) => {
    if (!currentQuestion) return;
    const isLink = currentQuestion.request.mode === "url";
    appendAcpEvent({
      id: `question-answer-${currentQuestion.requestId}`,
      category: "permission",
      label: isLink ? "Link request answered" : "Question answered",
      detail:
        response.action === "accept"
          ? isLink
            ? "opened in browser"
            : "answered"
          : response.action,
      state: response.action === "accept" ? "success" : "info",
    });
    try {
      await questionActions.answer(currentQuestion.requestId, response);
    } catch (error) {
      console.error("Failed to answer agent question:", error);
      showToast({ message: "The agent stopped waiting for this answer.", type: "error" });
    }
  };
  const handlePermission = async (approved: boolean, optionId?: string) => {
    if (!currentPermission) return;
    const option = currentPermission.options.find((item) => item.id === optionId);
    appendAcpEvent({
      id: `permission-response-${currentPermission.requestId}`,
      category: "permission",
      label: "Permission response",
      detail: option?.name || (approved ? "allow" : "deny"),
      state: approved ? "success" : "info",
    });
    try {
      await permissionActions.respond(currentPermission.requestId, approved, optionId);
    } catch (error) {
      console.error("Failed to answer permission request:", error);
      showToast({
        message: "The agent did not accept the answer. Stop the agent and try again.",
        type: "error",
      });
    }
  };

  const composer = (
    <AIChatInputBar
      key={effectiveChatId ?? "new-session"}
      surfaceId={surfaceId}
      chatId={effectiveChatId}
      buffers={buffers}
      allProjectFiles={allProjectFiles}
      currentAgentId={currentAgentId}
      onAgentChange={(agentId, model) => {
        if (isTerminalAgent(agentId)) {
          openTerminalAgent(agentId);
          return;
        }
        const nextChatId = chatActions.selectChatAgent(effectiveChatId, agentId, {
          activate: !chatId,
          model,
        });
        if (chatId && nextChatId && nextChatId !== effectiveChatId)
          openAgentHistoryChat(nextChatId);
      }}
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
      onUpdateQueuedMessage={(index, message) => {
        if (effectiveChatId) chatActions.updateQueuedAgentMessage(effectiveChatId, index, message);
      }}
      onRemoveQueuedMessage={(index) => {
        if (effectiveChatId) {
          chatActions.removeQueuedAgentMessage(effectiveChatId, index);
          void recordFrictionSignal({ area: "agent", signal: "queue_discard" });
        }
      }}
      onSendQueuedMessageNow={handleSendQueuedMessageNow}
      onEditQueuedMessage={handleEditQueuedMessage}
      onStopStreaming={stopStreaming}
      restoredPrompt={refusedPrompt}
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
        <Empty className="h-full p-6">
          <EmptyHeader>
            <EmptyTitle>Agent is disabled</EmptyTitle>
            <EmptyDescription>
              Your organization policy has disabled Agent for this workspace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !isChatMessagesLoaded ? (
        <Empty className="h-full p-6">
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
                      getAgentMessageAccess(currentAgentId, hasSessionApiKey).accepted &&
                      !isSurfaceTyping &&
                      !surfaceStreamingMessageId &&
                      !isAiChatBlockedByPolicy
                    }
                    acpEvents={timelineEvents}
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

          {currentQuestion?.request.mode === "url" ? (
            <AcpUrlQuestionPrompt
              key={currentQuestion.requestId}
              request={currentQuestion.request}
              agentLabel={assistantLabel}
              queuedCount={agentQuestions.length - 1}
              waiting={currentQuestion.waiting ?? false}
              onAnswer={handleQuestionAnswer}
              onDismiss={() => questionActions.remove(currentQuestion.requestId)}
            />
          ) : currentQuestion ? (
            <AcpQuestionPrompt
              key={currentQuestion.requestId}
              requestId={currentQuestion.requestId}
              request={currentQuestion.request}
              agentLabel={assistantLabel}
              queuedCount={agentQuestions.length - 1}
              onAnswer={handleQuestionAnswer}
            />
          ) : null}

          {!useInitialComposer ? composer : null}
        </>
      )}
    </div>
  );
});

export default AIChat;

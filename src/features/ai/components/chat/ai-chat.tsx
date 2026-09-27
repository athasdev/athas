import { cancelIntelligenceAgent } from "@/features/ai/intelligence/services/intelligence-agent-session";
import { getLocalChatConnection } from "@/features/ai/lib/local-ai-connection";
import { getProviderAccessFromMap } from "@/features/ai/stores/ai-chat/provider-actions";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { openTerminalAgent } from "@/features/ai/lib/terminal-agent-terminal";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appendChatAcpEvent, type ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import { acpNoticeToChatEvent } from "@/features/ai/lib/acp-notices";
import { partitionContextSelections } from "@/features/ai/lib/context-references";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import {
  beginQueuedSendNow,
  setQueuedMessageEditing,
  settleQueuedSendNow,
} from "@/features/ai/lib/agent-queue-controls";
import { isBrowserOffline } from "@/features/ai/lib/agent-turn-error";
import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import {
  type AgentTurnRequest,
  getAgentAccessMessage,
  runAgentTurn,
} from "@/features/ai/services/agent-turn-runner";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import type {
  ImageContent,
  QueuedAgentMessage,
  RestoredComposerPrompt,
} from "@/features/ai/types/ai-chat.types";
import { type AgentRunEnding, continuesAgentQueue } from "@/features/ai/lib/agent-message-queue";
import { useAcpNoticesStore } from "@/features/ai/stores/acp-notices.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import { peekAgentDraft } from "@/features/ai/detached/agent-window-drafts";
import { useComposerContextSelection } from "@/features/ai/hooks/use-composer-context-selection";
import { useOnlineStatus } from "@/features/ai/hooks/use-online-status";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { AgentMessageSubmitResult, AIChatProps } from "@/features/ai/types/ai-chat.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import {
  getFallbackAgentSessionTitle,
  normalizeAgentSessionTitle,
} from "@/features/ai/utils/chat-session-title";
import { getMessageSearchMatches } from "@/features/ai/utils/message-search";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { recordFrictionSignal } from "@/features/telemetry/services/telemetry";
import { claimContextualTip } from "@/features/onboarding/lib/contextual-teaching";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
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
import { AcpQuestionPrompt } from "./acp-question-prompt";
import { AcpUrlQuestionPrompt } from "./acp-url-question-prompt";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { HostedUsageBanner } from "./hosted-usage-banner";

const AIChat = memo(function AIChat({
  className,
  surfaceId,
  chatId,
  isActiveSurface = true,
  activeBuffer,
  buffers = [],
  selectedFiles = [],
  allProjectFiles = [],
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
  const { showToast } = useToast();

  const abortControllerRef = useRef<AbortController | null>(null);
  const offlineHeldChatsRef = useRef(new Set<string>());
  const isOnline = useOnlineStatus();
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
  const assistantLabel =
    currentAgentId === "custom"
      ? (currentChat?.modelId ?? currentChat?.providerId ?? aiProviderId)
      : currentAgentId;
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

      // A chat on a local model titles itself with that model, so its text stays on the machine.
      const localConnection = getLocalChatConnection(
        useAIChatStore.getState().actions.getChatById(chatId),
        useSettingsStore.getState().settings,
      );
      try {
        const { editedText } = await requestInlineEdit({
          ...(localConnection
            ? { provider: localConnection.providerId, model: localConnection.modelId }
            : { model: "" }),
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
      selectedProjectFiles: partitionContextSelections(selectedFilesPaths).filePaths,
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
    if (isBrowserOffline() && useAIChatStore.getState().agentMessageQueues[targetChatId]?.length) {
      // Sending now would only fail; the queue resumes when the connection is back.
      offlineHeldChatsRef.current.add(targetChatId);
      return;
    }
    const nextMessage = actions.dequeueAgentMessage(targetChatId);
    if (nextMessage) {
      queueMicrotask(
        () =>
          void processMessage(nextMessage.content, { targetChatId, images: nextMessage.images }),
      );
    }
  }

  function processMessage(messageContent: string, options: Omit<AgentTurnRequest, "content"> = {}) {
    return runAgentTurn(
      { ...options, content: messageContent },
      {
        surfaceChatId: effectiveChatId,
        isBoundToChat: Boolean(chatId),
        fallbackProviderId: aiProviderId,
        outputStyle: chatState.outputStyle,
        allProjectFiles,
        selectedFilesPaths,
        abortControllerRef,
        buildContext,
        showError: (message) => showToast({ message, type: "error" }),
        appendAcpEvent,
        clearAcpEvents: () => setAcpEvents([]),
        restorePrompt: setRefusedPrompt,
        finishRun: finishRunAndProcessQueue,
        onFirstExchange: (targetChatId, userContent) =>
          void updateInitialAgentSessionTitle(targetChatId, userContent),
      },
    );
  }

  const sendMessage = useCallback(
    (messageContent: string, images?: ImageContent[]): AgentMessageSubmitResult => {
      if (agentIsDetached(effectiveChatId))
        return { accepted: false, error: "This agent is open in another window." };
      if (!messageContent.trim() && !images?.length) return { accepted: false };
      const access = getAgentMessageAccess(currentAgentId, hasSessionApiKey);
      if (!access.accepted) {
        showToast({
          message: getAgentAccessMessage(currentAgentId, sessionProviderId, access.error),
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
      const needsNetwork = !(currentAgentId === "custom" && sessionProviderId === "ollama");
      if (
        targetChatId &&
        !useAIChatStore.getState().agentRuns[targetChatId] &&
        needsNetwork &&
        isBrowserOffline()
      ) {
        chatActions.enqueueAgentMessage(targetChatId, messageContent, images);
        offlineHeldChatsRef.current.add(targetChatId);
        showToast({
          message: "You're offline",
          description: "The message is queued and sends when the connection is back.",
          type: "info",
        });
        return { accepted: true };
      }
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
      sessionProviderId,
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
          message: getAgentAccessMessage(currentAgentId, sessionProviderId, access.error),
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
      sessionProviderId,
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

  // Messages held while offline go out once the connection is back.
  useEffect(() => {
    if (!isOnline || !effectiveChatId || !offlineHeldChatsRef.current.has(effectiveChatId)) return;
    offlineHeldChatsRef.current.delete(effectiveChatId);
    const store = useAIChatStore.getState();
    if (store.agentRuns[effectiveChatId]) return;
    const next = store.actions.dequeueAgentMessage(effectiveChatId);
    if (next) {
      void processMessageRef.current(next.content, {
        targetChatId: effectiveChatId,
        images: next.images,
      });
    }
  }, [effectiveChatId, isOnline]);

  /** Runs the last prompt again, stopping a stalled turn first. */
  const retryLastTurn = async () => {
    if (!effectiveChatId || agentIsDetached(effectiveChatId)) return;
    const messages = useAIChatStore.getState().actions.getMessagesForChat(effectiveChatId);
    const prompt = [...messages].reverse().find((message) => message.role === "user");
    if (!prompt?.content.trim()) return;
    void recordFrictionSignal({ area: "agent", signal: "retry" });
    if (useAIChatStore.getState().agentRuns[effectiveChatId]) await stopStreaming();
    void processMessageRef.current(prompt.content, {
      editedUserMessageId: prompt.id,
      targetChatId: effectiveChatId,
      retried: true,
    });
  };

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
    if (pendingLaunch.mode === "append") {
      composerContext.append(
        pendingLaunch.selectedBufferIds,
        pendingLaunch.selectedFilesPaths,
        pendingLaunch.editorSelections,
      );
      chatActions.setPendingAgentLaunchRequest(null);
      return;
    }
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
        message: getAgentAccessMessage(currentAgentId, sessionProviderId, access.error),
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
    sessionProviderId,
    currentAgentId,
    isSurfaceTyping,
    chatState.pendingAgentLaunchRequest,
    surfaceStreamingMessageId,
    activeBuffer,
    composerContext.append,
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
  const lastMessage = currentChat?.messages[currentChat.messages.length - 1];
  const lastTurnFailed = lastMessage?.role === "assistant" && Boolean(lastMessage.error);
  const turnNotice = !isOnline
    ? {
        tone: "warning" as const,
        title: "You're offline",
        description: "Messages you send wait in the queue until the connection is back.",
        canRetry: false,
      }
    : lastTurnFailed && lastMessage?.error?.code === "offline"
      ? {
          tone: "info" as const,
          title: "Back online",
          description: "Run the last prompt again.",
          canRetry: true,
        }
      : null;
  const showHostedUsage =
    !useInitialComposer && currentAgentId === "custom" && sessionProviderId === "athas";
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
              <EmptyDescription>Its saved messages could not be read.</EmptyDescription>
            ) : null}
          </EmptyHeader>
          {chatMessageLoadState === "error" && effectiveChatId ? (
            <EmptyContent>
              <Button
                type="button"
                onClick={() =>
                  void useAIChatStore.getState().actions.loadChatMessages(effectiveChatId)
                }
              >
                Retry
              </Button>
            </EmptyContent>
          ) : null}
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
                    onSendFollowUp={handleSendFollowUp}
                    onEditUserMessage={handleEditUserMessage}
                    onRetryStalledResponse={() => void retryLastTurn()}
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

          {turnNotice ? (
            <div className="shrink-0 px-2 pb-1">
              <Alert tone={turnNotice.tone} role="status">
                <AlertTitle>{turnNotice.title}</AlertTitle>
                <AlertDescription>{turnNotice.description}</AlertDescription>
                {turnNotice.canRetry ? (
                  <AlertAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => void retryLastTurn()}
                    >
                      Retry
                    </Button>
                  </AlertAction>
                ) : null}
              </Alert>
            </div>
          ) : null}
          {showHostedUsage ? (
            <div className="shrink-0 px-2 pb-1">
              <HostedUsageBanner />
            </div>
          ) : null}
          {!useInitialComposer ? composer : null}
        </>
      )}
    </div>
  );
});

export default AIChat;

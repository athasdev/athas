import type { MutableRefObject } from "react";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import { getAgentStopNotice } from "@/features/ai/lib/agent-stop-notice";
import { type AgentRunEnding, getAgentRunEnding } from "@/features/ai/lib/agent-message-queue";
import {
  describeAgentTurnFailure,
  formatErrorBlock,
  isBrowserOffline,
} from "@/features/ai/lib/agent-turn-error";
import { parseDirectAcpUiAction } from "@/features/ai/lib/acp-ui-intents";
import { withExitedAcpTerminalSnapshots } from "@/features/ai/lib/acp-terminal-output";
import type { ChatAcpEventInput } from "@/features/ai/lib/acp-event-timeline";
import { startAssistantResponseContinuation } from "@/features/ai/lib/assistant-response";
import { buildConversationHistory } from "@/features/ai/lib/conversation-history";
import { filterAgentContext, loadAgentContextPolicy } from "@/features/ai/lib/agent-context-policy";
import {
  discardToolEditSnapshot,
  resolveToolEditDiff,
  snapshotToolEdit,
} from "@/features/ai/lib/edit-diff-capture";
import {
  appendReferencedFiles,
  loadFilesByPaths,
  parseMentionsAndLoadFiles,
} from "@/features/ai/lib/file-mentions";
import { extractFollowUpActions } from "@/features/ai/lib/follow-up-actions";
import { applyAttachmentBudget } from "@/features/ai/lib/context-budget";
import {
  partitionContextSelections,
  resolveContextReferences,
} from "@/features/ai/lib/context-references";
import { getAcpPermissionPreview } from "@/features/ai/lib/acp-permission-preview";
import { claimRunAbortController } from "@/features/ai/lib/run-abort-controller";
import {
  cancelUnfinishedToolCalls,
  createToolCall,
  markToolCallComplete,
  updateToolCall,
} from "@/features/ai/lib/tool-call-state";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { selectChatMode } from "@/features/ai/lib/composer-modes";
import { followAgentLocations, followAgentTo } from "@/features/ai/services/agent-follow-service";
import { recordAgentFileWrite } from "@/features/ai/services/agent-edits-service";
import {
  sendAgentNativeNotification,
  type AgentNativeNotificationKind,
} from "@/features/ai/services/agent-native-notifications";
import { getChatCompletionStream, isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { getProviderAccessFromMap } from "@/features/ai/stores/ai-chat/provider-actions";
import { useAcpTerminalsStore } from "@/features/ai/stores/acp-terminals.store";
import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";
import type {
  ImageContent,
  Message,
  MessageUsage,
  OutputStyle,
  RestoredComposerPrompt,
} from "@/features/ai/types/ai-chat.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { AiFailurePhase, AiRunKind } from "@/features/telemetry/lib/ai-signals";
import { recordAiFailure } from "@/features/telemetry/services/telemetry";
import { useAuthStore } from "@/features/window/stores/auth.store";

export interface AgentTurnRequest {
  content: string;
  editedUserMessageId?: string;
  targetChatId?: string;
  images?: ImageContent[];
  /** Set when the user asked to run a failed or stalled turn again. */
  retried?: boolean;
}

/** What a chat surface lends a turn: its context, its timeline and its queue. */
export interface AgentTurnHost {
  /** The chat the surface shows, used when a request names none. */
  surfaceChatId: string | null | undefined;
  /** Whether the surface is bound to one chat (a tab) instead of following the current chat. */
  isBoundToChat: boolean;
  fallbackProviderId: string;
  outputStyle: OutputStyle;
  allProjectFiles: FileEntry[];
  selectedFilesPaths: Set<string>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  buildContext: (agentId: string, providerId: string) => Promise<ContextInfo>;
  showError: (message: string) => void;
  appendAcpEvent: (event: ChatAcpEventInput) => void;
  clearAcpEvents: () => void;
  restorePrompt: (prompt: RestoredComposerPrompt) => void;
  finishRun: (chatId: string, runId: string, ending?: AgentRunEnding) => void;
  onFirstExchange: (chatId: string, userContent: string) => void;
}

const createMessageId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function chatActions() {
  return useAIChatStore.getState().actions;
}

/** The toast shown when an agent cannot take a prompt yet. */
export function getAgentAccessMessage(
  agentId: string,
  providerId: string,
  accessError: string | undefined,
): string {
  return agentId === "custom" && providerId === "athas"
    ? "Sign in and add Athas Agent balance to use hosted models."
    : (accessError ?? "This agent is not ready.");
}

function runKind(agentId: string): AiRunKind {
  if (agentId === CODEX_INTEGRATION_ID) return "codex";
  return isAcpAgent(agentId) ? "acp" : "builtin";
}

/** What Athas's own agent adds to a completion: its step count and what the turn cost. */
type BuiltInCompletion = AgentCompletionResult & { steps?: number; costUsd?: number };

/** Per-turn usage for the message footer, when the run reported any. */
export function toMessageUsage(completion?: BuiltInCompletion): MessageUsage | undefined {
  if (!completion) return undefined;
  const usage: MessageUsage = {};
  if (completion.usage?.inputTokens !== undefined) usage.inputTokens = completion.usage.inputTokens;
  if (completion.usage?.outputTokens !== undefined)
    usage.outputTokens = completion.usage.outputTokens;
  if (typeof completion.costUsd === "number" && Number.isFinite(completion.costUsd))
    usage.costCents = Math.round(completion.costUsd * 10_000) / 100;
  if (typeof completion.steps === "number" && completion.steps > 0) usage.steps = completion.steps;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

interface TurnSetup {
  chatId: string;
  runId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  isAcp: boolean;
  userMessage: Message;
  assistantMessageId: string;
  conversationHistory: ReturnType<typeof buildConversationHistory>;
  trimmedContent: string;
  retried: boolean;
}

/**
 * Phase 1: checks the agent can take the prompt, then records the prompt and an empty
 * assistant message and starts the chat's run. Returns null when nothing should run.
 */
function startTurn(request: AgentTurnRequest, host: AgentTurnHost): TurnSetup | null {
  const store = useAIChatStore.getState();
  const actions = store.actions;
  const requestedChatId = request.targetChatId ?? host.surfaceChatId;
  if (agentIsDetached(requestedChatId)) return null;
  const targetChat = requestedChatId
    ? store.chats.find((chat) => chat.id === requestedChatId)
    : null;
  const agentId = targetChat?.agentId ?? actions.getCurrentAgentId();
  const trimmedContent = request.content.trim();
  const chatProviderId = targetChat?.providerId ?? host.fallbackProviderId;
  const access = getAgentMessageAccess(
    agentId,
    getProviderAccessFromMap(chatProviderId, store.providerApiKeys),
  );
  if (!trimmedContent && !request.images?.length && !request.editedUserMessageId) return null;
  if (!access.accepted) {
    host.showError(getAgentAccessMessage(agentId, chatProviderId, access.error));
    return null;
  }

  let chatId = requestedChatId ?? store.currentChatId;
  chatId = chatId
    ? actions.ensureChatSession(chatId, agentId, { activate: !host.isBoundToChat })
    : actions.createNewChat(agentId);

  const existingMessages = actions.getMessagesForChat(chatId);
  const editedIndex = request.editedUserMessageId
    ? existingMessages.findIndex(
        (message) => message.id === request.editedUserMessageId && message.role === "user",
      )
    : -1;
  if (request.editedUserMessageId && editedIndex === -1) return null;

  // The history builder leaves error blocks and failed turns out of what the model sees.
  const conversationHistory = buildConversationHistory(
    editedIndex >= 0 ? existingMessages.slice(0, editedIndex) : existingMessages,
  );
  const editedMessage = editedIndex >= 0 ? existingMessages[editedIndex] : undefined;
  const userMessage: Message = editedMessage
    ? { ...editedMessage, content: trimmedContent, timestamp: new Date() }
    : {
        id: createMessageId(),
        content: trimmedContent,
        role: "user",
        timestamp: new Date(),
        images: request.images,
      };

  const assistantMessage: Message = {
    id: createMessageId(),
    content: "",
    role: "assistant",
    timestamp: new Date(),
    isStreaming: true,
    responsePhase: "waiting",
  };
  if (request.editedUserMessageId) {
    if (!actions.replaceUserMessage(chatId, request.editedUserMessageId, trimmedContent))
      return null;
    // The edited prompt was just re-stamped; its answer must come after it.
    assistantMessage.timestamp = new Date();
  } else {
    actions.addMessage(chatId, userMessage);
  }
  actions.addMessage(chatId, assistantMessage);
  const runId = createMessageId();
  actions.startAgentRun(chatId, {
    runId,
    assistantMessageId: assistantMessage.id,
    agentId,
    phase: "waiting",
  });

  if (actions.getMessagesForChat(chatId).length === 2) {
    host.onFirstExchange(chatId, userMessage.content);
  }

  const settings = useSettingsStore.getState().settings;
  return {
    chatId,
    runId,
    agentId,
    providerId: targetChat?.providerId ?? settings.aiProviderId,
    modelId: targetChat?.modelId ?? settings.aiModelId,
    isAcp: isAcpAgent(agentId),
    userMessage,
    assistantMessageId: assistantMessage.id,
    conversationHistory,
    trimmedContent,
    // Re-sending an unchanged prompt from the transcript is a retry too.
    retried: request.retried === true || editedMessage?.content.trim() === trimmedContent,
  };
}

/**
 * Phase 2: loads mentioned and attached files and builds the context the provider sees.
 * Returns null when the prompt was a local UI intent that is already handled.
 */
async function buildTurnContext(
  turn: TurnSetup,
  host: AgentTurnHost,
): Promise<{ message: string; context: ContextInfo } | null> {
  const rawContext = await host.buildContext(turn.agentId, turn.providerId);
  const allowsPath = await loadAgentContextPolicy(rawContext.projectRoot);
  const context = filterAgentContext(rawContext, allowsPath);
  const { mentionedFiles } = await parseMentionsAndLoadFiles(
    turn.trimmedContent,
    host.allProjectFiles,
    allowsPath,
  );
  const mentionedPaths = new Set(mentionedFiles.map((file) => file.path));
  const contextSelections = partitionContextSelections(host.selectedFilesPaths);
  const attachedFiles = turn.isAcp
    ? []
    : await loadFilesByPaths(
        contextSelections.filePaths.filter((path) => allowsPath(path) && !mentionedPaths.has(path)),
      );
  context.images = turn.userMessage.images;
  const { attachments: referencedFiles } = applyAttachmentBudget(
    [...mentionedFiles, ...attachedFiles].filter((file) => allowsPath(file.path)),
  );
  context.mentionedFiles = referencedFiles;
  context.contextReferences = await resolveContextReferences(contextSelections.references, {
    projectRoot: context.projectRoot,
    allowsPath,
  });

  // Direct ACP UI intents run locally so they are always reliable.
  if (turn.isAcp && !turn.userMessage.images?.length) {
    const directAction = parseDirectAcpUiAction(turn.trimmedContent);
    if (directAction) {
      if (directAction.kind === "open_terminal" && directAction.command) {
        useBufferStore.getState().actions.openTerminalBuffer({
          command: directAction.command,
          name: directAction.command,
        });
        chatActions().updateMessage(turn.chatId, turn.assistantMessageId, {
          content: `Opened terminal and ran \`${directAction.command}\`.`,
          isStreaming: false,
        });
      }
      return null;
    }
  }

  if (turn.isAcp) host.clearAcpEvents();
  return {
    message: turn.isAcp
      ? turn.trimmedContent
      : appendReferencedFiles(turn.trimmedContent, referencedFiles),
    context,
  };
}

/**
 * Phase 3 and 4: follows the provider's stream into the assistant message and settles the
 * turn when it completes or fails.
 */
class AgentTurnStream {
  private rawContent = "";
  private stateOnlyUpdate = false;
  private commandResultLabel: string | null = null;
  private settled = false;

  constructor(
    private readonly turn: TurnSetup,
    private readonly host: AgentTurnHost,
    private readonly releaseAbortController: () => void,
  ) {}

  private get chatId() {
    return this.turn.chatId;
  }

  private get messageId() {
    return this.turn.assistantMessageId;
  }

  private currentMessage() {
    return chatActions()
      .getMessagesForChat(this.chatId)
      .find((message) => message.id === this.messageId);
  }

  private update(mutate: (currentMessage: Message | undefined) => Partial<Message>) {
    const updates = mutate(this.currentMessage());
    if (updates.toolCalls) {
      updates.toolCalls = withExitedAcpTerminalSnapshots(
        updates.toolCalls,
        useAcpTerminalsStore.getState().terminals,
      );
    }
    chatActions().updateMessage(this.chatId, this.messageId, updates);
  }

  private notify(kind: AgentNativeNotificationKind, dedupeId: string = this.messageId) {
    if (!this.turn.isAcp && this.turn.agentId !== CODEX_INTEGRATION_ID) return;
    void sendAgentNativeNotification({
      kind,
      dedupeId: `${this.chatId}:${dedupeId}`,
      chatId: this.chatId,
    });
  }

  private finish(ending: AgentRunEnding) {
    this.settled = true;
    this.host.finishRun(this.chatId, this.turn.runId, ending);
    this.releaseAbortController();
    // Hosted turns spend credits; keep the usage ring and balance banner current.
    if (this.turn.agentId === "custom" && this.turn.providerId === "athas") {
      useAuthStore.getState().actions.scheduleSubscriptionRefresh();
    }
  }

  private recordFailure(phase: AiFailurePhase, code?: string, status?: number, steps?: number) {
    void recordAiFailure({
      kind: runKind(this.turn.agentId),
      providerId: this.turn.isAcp ? this.turn.agentId : this.turn.providerId,
      modelId: this.turn.isAcp ? null : this.turn.modelId,
      code,
      status,
      phase,
      stepCount: steps ?? this.currentMessage()?.toolCalls?.length ?? 0,
      retried: this.turn.retried,
      // A stop ends the run before the provider reports back.
      cancelled: useAIChatStore.getState().agentRuns[this.chatId]?.runId !== this.turn.runId,
    });
  }

  /**
   * Where streamed text lands; queued so a burst of tokens reaches the store once per frame. The
   * follow-up block is split off when the frame lands rather than per token, which rescanned the
   * whole reply for every chunk.
   */
  onChunk = (chunk: string) => {
    this.rawContent += chunk;
    chatActions().queueMessageUpdate(this.chatId, this.messageId, this.resolveStreamedContent);
  };

  private resolveStreamedContent = (): Partial<Message> => {
    const extracted = extractFollowUpActions(this.rawContent);
    return {
      content: extracted.content,
      followUpActions: extracted.actions,
      responsePhase: undefined,
    };
  };

  onComplete = (completion?: BuiltInCompletion) => {
    const { chatId, turn } = this;
    // The final chunks may still be queued; the checks below read the finished content.
    chatActions().flushMessageUpdates(chatId);
    useAgentPermissionsStore.getState().actions.dropSettled(chatId);
    const wasCancelled = completion?.outcome === "cancelled";
    if (wasCancelled || (completion?.stopReason && completion.stopReason !== "end_turn")) {
      // The turn is over; a call the agent never finished must not stay running.
      this.update((message) => ({ toolCalls: cancelUnfinishedToolCalls(message?.toolCalls) }));
    }
    const message = this.currentMessage();
    const hasVisibleResponse = Boolean(
      message?.content?.trim() ||
      message?.toolCalls?.length ||
      message?.images?.length ||
      message?.resources?.length,
    );
    const stopNotice = wasCancelled
      ? undefined
      : getAgentStopNotice(completion?.stopReason, message);
    const turnUsage = completion?.usage;
    const usage = toMessageUsage(completion);

    if (stopNotice) {
      this.update(() => ({
        stopNotice,
        turnUsage,
        usage,
        isStreaming: false,
        responsePhase: undefined,
      }));
      if (stopNotice === "prompt_refused") {
        // The prompt was rejected; hand it back so the user can rephrase it.
        this.host.restorePrompt({
          id: this.messageId,
          content: turn.userMessage.content,
          images: turn.userMessage.images,
        });
      }
      this.finish(getAgentRunEnding(false, stopNotice));
      this.notify(
        stopNotice === "prompt_refused" || stopNotice === "refused" ? "error" : "complete",
      );
      return;
    }

    if (!hasVisibleResponse && wasCancelled) {
      this.update(() => ({ content: "_Stopped._", isStreaming: false, responsePhase: undefined }));
      this.finish("stopped");
      return;
    }

    if (!hasVisibleResponse) {
      if (turn.isAcp && this.stateOnlyUpdate) {
        const slashCommand = turn.trimmedContent.match(/^\/([^\s]+)/)?.[1];
        const fallbackContent =
          this.commandResultLabel ||
          (slashCommand ? `Applied \`/${slashCommand}\`.` : "Session updated.");
        this.update(() => ({ content: fallbackContent, isStreaming: false }));
        this.finish(getAgentRunEnding(wasCancelled));
        if (!wasCancelled) this.notify("complete");
        return;
      }

      const fallbackMessage = turn.isAcp
        ? "The selected agent did not return a visible response. Try sending the message again."
        : "The selected provider did not return a visible response. Try another model or send the message again.";
      const source = turn.isAcp ? "agent session" : "provider request";
      const details = `The ${source} completed, but no content, tool output, or resource was returned.`;
      this.update(() => ({
        content: formatErrorBlock({
          title: "No Response",
          code: "EMPTY_RESPONSE",
          message: fallbackMessage,
          details,
        }),
        error: {
          code: "empty_response",
          title: "No Response",
          message: fallbackMessage,
          details,
          retryable: true,
        },
        isStreaming: false,
      }));
      this.finish(wasCancelled ? "stopped" : "failed");
      if (!wasCancelled) {
        this.notify("error");
        this.recordFailure("empty_response", "empty_response", undefined, completion?.steps);
      }
      return;
    }

    chatActions().updateMessage(chatId, this.messageId, { isStreaming: false, turnUsage, usage });
    this.finish(getAgentRunEnding(wasCancelled));
    if (!wasCancelled) this.notify("complete");
  };

  onError = (error: string, canReconnect?: boolean) => {
    this.fail(error, "provider", canReconnect);
  };

  /** Settles the turn as failed: a legacy error block for the reader plus a structured error. */
  fail(error: string, phase: AiFailurePhase, canReconnect?: boolean) {
    if (this.settled) return;
    chatActions().flushMessageUpdates(this.chatId);
    useAgentPermissionsStore.getState().actions.dropSettled(this.chatId);
    console.error("Streaming error:", error);
    const failure = describeAgentTurnFailure({
      error,
      canReconnect,
      providerId: this.turn.providerId,
      isAcp: this.turn.isAcp,
    });
    const block = formatErrorBlock({
      title: failure.title,
      code: failure.blockCode,
      provider: this.turn.providerId,
      message: failure.message,
      details: failure.details,
    });
    this.update((message) => ({
      content: message?.content ? `${message.content}\n\n${block}` : block,
      error: failure.error,
      toolCalls: cancelUnfinishedToolCalls(message?.toolCalls),
      isStreaming: false,
      responsePhase: undefined,
    }));
    if (!failure.suppressToast) this.host.showError(failure.message);
    this.notify("error");
    this.recordFailure(phase, failure.error.code, failure.error.status);
    this.finish("failed");
    // A payment failure means the balance moved; show the real numbers right away.
    if (failure.error.status === 402) void useAuthStore.getState().actions.refreshSubscription();
  }

  onResponseContinuation = () => {
    this.rawContent = startAssistantResponseContinuation(this.rawContent);
    chatActions().updateMessage(this.chatId, this.messageId, {
      isStreaming: true,
      responsePhase: "waiting",
    });
    chatActions().updateAgentRun(this.chatId, this.turn.runId, {
      assistantMessageId: this.messageId,
      phase: "waiting",
    });
  };

  onToolUse = (event: Extract<AcpEvent, { type: "tool_start" }>) => {
    chatActions().updateAgentRun(this.chatId, this.turn.runId, { phase: "tool" });
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
    this.update((message) => ({
      isToolUse: true,
      toolName: event.toolName,
      toolCalls: [
        ...(message?.toolCalls || []),
        { ...toolCall, contentOffset: (message?.content ?? "").length },
      ],
    }));
  };

  onToolUpdate = (event: Extract<AcpEvent, { type: "tool_update" }>) => {
    this.update((message) => ({
      toolCalls: updateToolCall(message?.toolCalls || [], {
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
    }));
  };

  onToolComplete = (toolName: string, toolId?: string, output?: unknown, error?: string) => {
    this.update((message) => ({
      toolCalls: markToolCallComplete(message?.toolCalls || [], toolName, toolId, output, error),
    }));
    const completed = this.currentMessage()?.toolCalls?.find((toolCall) =>
      toolId ? toolCall.id === toolId : toolCall.name === toolName && toolCall.isComplete,
    );
    if (!completed?.id || error) {
      discardToolEditSnapshot(completed?.id ?? toolId);
      return;
    }
    const completedId = completed.id;
    void resolveToolEditDiff(completed).then((nextOutput) => {
      if (!nextOutput) return;
      this.update((message) => ({
        toolCalls: updateToolCall(message?.toolCalls || [], {
          id: completedId,
          output: nextOutput,
        }),
      }));
    });
  };

  onPermissionRequest = (event: Extract<AcpEvent, { type: "permission_request" }>) => {
    chatActions().updateAgentRun(this.chatId, this.turn.runId, { phase: "approval" });
    this.notify("permission", event.requestId);
    this.host.appendAcpEvent({
      id: `permission-request-${event.requestId}`,
      category: "permission",
      label: "Permission requested",
      detail: event.description || `${event.permissionType} ${event.resource}`.trim(),
      state: "info",
    });
    useAgentPermissionsStore.getState().actions.add({
      chatId: this.chatId,
      responder: event.requestId.startsWith("intelligence:")
        ? "intelligence"
        : this.turn.agentId === CODEX_INTEGRATION_ID
          ? "codex"
          : "acp",
      requestId: event.requestId,
      description: event.description,
      permissionType: event.permissionType,
      resource: event.resource,
      options: event.options,
      preview: getAcpPermissionPreview(event),
    });
  };

  onAcpEvent = (event: AcpEvent) => {
    // Athas's own agent sends only its todo list through here.
    if (
      !this.turn.isAcp &&
      this.turn.agentId !== CODEX_INTEGRATION_ID &&
      event.type !== "plan_update"
    )
      return;
    const { chatId } = this;
    const runId = this.turn.runId;
    if (event.type === "elicitation_request") {
      chatActions().updateAgentRun(chatId, runId, { phase: "approval" });
      this.notify("question", event.requestId);
      this.host.appendAcpEvent({
        id: `question-${event.requestId}`,
        category: "permission",
        label: "Question asked",
        detail: event.request.message,
        state: "info",
      });
      return;
    }
    switch (event.type) {
      case "thought_chunk":
        chatActions().updateAgentRun(chatId, runId, { phase: "thinking" });
        this.update(() => ({ responsePhase: "thinking" }));
        break;
      case "tool_start":
      case "tool_update":
        followAgentLocations(chatId, event.locations);
        break;
      case "agent_location":
        followAgentTo(chatId, { path: event.path, line: event.line });
        break;
      case "agent_file_write":
        recordAgentFileWrite(chatId, {
          writeId: event.writeId,
          path: event.path,
          previousContent: event.previousContent,
          content: event.content,
        });
        break;
      case "session_mode_update":
        this.stateOnlyUpdate = true;
        this.commandResultLabel = event.modeState.currentModeId
          ? `Mode set to \`${event.modeState.currentModeId}\`.`
          : "Session mode updated.";
        break;
      case "config_options_update":
        this.stateOnlyUpdate = true;
        this.commandResultLabel =
          event.configOptions.length === 1 ? "Session option updated." : "Session options updated.";
        break;
      case "session_info_update":
        this.stateOnlyUpdate = true;
        this.commandResultLabel = event.title
          ? `Session title updated to "${event.title}".`
          : "Session metadata updated.";
        if (event.title) {
          this.host.appendAcpEvent({
            category: "status",
            label: "Session title updated",
            detail: event.title,
            state: "info",
          });
        }
        break;
      case "current_mode_update":
        this.stateOnlyUpdate = true;
        this.commandResultLabel = `Mode set to \`${event.currentModeId}\`.`;
        break;
      case "slash_commands_update":
        this.stateOnlyUpdate = true;
        this.commandResultLabel = "Slash commands refreshed.";
        break;
      case "plan_update":
        // ACP sends the full plan each time; the message shows the latest one.
        chatActions().updateMessage(chatId, this.messageId, {
          plan: event.entries.length > 0 ? event.entries : undefined,
        });
        break;
      case "error":
        this.host.appendAcpEvent({
          category: "error",
          label: "Agent error",
          detail: event.error,
          state: "error",
        });
        break;
      // Content arrives through onChunk, permissions through their own prompt, and usage and
      // status through the chat store; the rest is not worth showing.
      default:
        break;
    }
  };

  onImageChunk = (data: string, mediaType: string) => {
    this.update((message) => ({ images: [...(message?.images || []), { data, mediaType }] }));
  };

  onResourceChunk = (uri: string, name: string | null) => {
    this.update((message) => ({ resources: [...(message?.resources || []), { uri, name }] }));
  };

  onResponsePhase = (phase: "starting" | "waiting" | "stalled") => {
    this.update((message) =>
      message?.isStreaming && !message.content && message.responsePhase !== "thinking"
        ? { responsePhase: phase }
        : {},
    );
  };
}

/**
 * Runs one agent turn end to end: starts it, builds its context, streams the provider's
 * answer into the transcript and settles the chat's run when it ends.
 */
export async function runAgentTurn(request: AgentTurnRequest, host: AgentTurnHost) {
  const turn = startTurn(request, host);
  if (!turn) return;

  // A stopped turn can finish after the next one started; it only clears its own controller.
  const { release } = claimRunAbortController(host.abortControllerRef);
  const stream = new AgentTurnStream(turn, host, release);

  let prepared: Awaited<ReturnType<typeof buildTurnContext>>;
  try {
    prepared = await buildTurnContext(turn, host);
  } catch (error) {
    console.error("Failed to prepare the agent turn:", error);
    stream.fail(
      `Could not prepare the prompt: ${error instanceof Error ? error.message : String(error)}`,
      "context",
    );
    return;
  }
  if (!prepared) {
    host.finishRun(turn.chatId, turn.runId);
    release();
    return;
  }

  try {
    await getChatCompletionStream(
      turn.agentId,
      turn.providerId,
      turn.modelId,
      prepared.message,
      prepared.context,
      stream.onChunk,
      stream.onComplete,
      stream.onError,
      turn.conversationHistory,
      stream.onResponseContinuation,
      stream.onToolUse,
      stream.onToolUpdate,
      stream.onToolComplete,
      stream.onPermissionRequest,
      stream.onAcpEvent,
      // The mode of the chat the turn runs in, which a queued turn keeps after the user moved on.
      selectChatMode(useAIChatStore.getState(), turn.chatId),
      host.outputStyle,
      stream.onImageChunk,
      stream.onResourceChunk,
      turn.chatId,
      undefined,
      stream.onResponsePhase,
    );
  } catch (error) {
    console.error("Failed to start streaming:", error);
    stream.fail(
      isBrowserOffline()
        ? "You're offline."
        : `Failed to connect to the agent service: ${error instanceof Error ? error.message : String(error)}`,
      "stream",
    );
  }
}

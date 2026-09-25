import type { AcpElicitationResponse } from "../lib/acp-elicitation";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type {
  AcpAgentStatus,
  AcpEvent,
  AcpOpenedSession,
  AcpPromptContentBlock,
  AcpSessionList,
  AcpStopReason,
  AgentConfig,
} from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getAcpPathBaseName, toAcpFileUri } from "@/features/ai/lib/acp-file-uri";
import {
  getAcpStartupErrorDetails,
  isAcpAuthenticationError,
} from "@/features/ai/lib/acp-authentication";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
import { getAcpAgentKey, selectAcpAgentStatus } from "@/features/ai/lib/acp-session-state";
import { getFollowUpActionsInstruction } from "@/features/ai/lib/follow-up-actions";
import { formatSkippedMcpServersNotice } from "@/features/ai/lib/mcp-servers";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { buildContextPrompt } from "../utils/ai-context-builder";

interface AcpHandlers {
  onChunk: (chunk: string) => void;
  onComplete: (result?: AgentCompletionResult) => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onResponseContinuation?: () => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolUpdate?: (event: Extract<AcpEvent, { type: "tool_update" }>) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
  onImageChunk?: (data: string, mediaType: string) => void;
  onResourceChunk?: (uri: string, name: string | null) => void;
  /** What the reply is waiting on before the agent's first activity arrives. */
  onResponsePhase?: (phase: AcpWaitingPhase) => void;
}

/** `starting` while the agent process starts, `stalled` once a prompt has waited a while. */
type AcpWaitingPhase = "starting" | "waiting" | "stalled";

interface AcpListeners {
  event?: () => void;
}

// The bridge bounds each startup step (initialize, which may include a first-run download,
// authenticate, session/new) and reports failures itself. This only catches a bridge that
// never answers, and it stops the startup when it gives up.
const ACP_START_TIMEOUT_MS = 10 * 60_000;
const ACP_PROMPT_TIMEOUT_MS = 10_000;
// Agents may think for a long time before their first update, so a quiet prompt only gets a
// hint; the bridge enforces the hard turn limit and cancels the turn on the agent.
const ACP_STILL_WAITING_MS = 20_000;
// After Stop, updates keep flowing until the agent answers session/cancel. An agent that never
// does must not keep the chat waiting forever.
const ACP_CANCEL_GRACE_MS = 10_000;
const ACP_STARTUP_STOPPED = "startup was stopped";
/** Runs without a chat id belong to the current chat; they share this key. */
const CURRENT_CHAT_KEY = "";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function hasSessionId(event: AcpEvent): event is AcpEvent & { sessionId: string } {
  return "sessionId" in event && typeof event.sessionId === "string";
}

/**
 * Streams one prompt turn of an ACP agent into a chat. Every chat has its own session on the
 * agent, and one agent process serves every chat that uses it in the workspace, so chats (with
 * the same agent or different ones) run side by side. Within one chat, turns run one at a time.
 */
export class AcpStreamHandler {
  /** The turn running in each chat, by chat id. */
  private static activeHandlers = new Map<string, AcpStreamHandler>();
  /** Session opens in flight, by chat id: a chat opens its session once at a time. */
  private static sessionQueues = new Map<string, Promise<void>>();
  private listeners: AcpListeners = {};
  private activeTools = new Map<string, string>();
  /** The turn is over and every handler that will be called has been. */
  private sessionComplete = false;
  private pendingNewMessage = false;
  /** Stop was pressed; the turn ends when the agent answers session/cancel. */
  private cancelRequested = false;
  private wasRunning = false;
  private activeSessionId: string | null = null;
  /** The agent holding the session, as of the latest status. */
  private agentStatus: AcpAgentStatus | null = null;
  private workspacePath: string | null = null;
  /** The chat this turn is registered under while it runs. */
  private registeredChatKey: string | null = null;
  private awaitingFirstResponse = false;
  private stillWaitingTimeout: ReturnType<typeof setTimeout> | null = null;
  private cancelGraceTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The sign-in method the user picked; startup authenticates with it if the agent asks. */
  private authMethodId: string | null = null;
  private resolveSettled: () => void = () => {};
  /** Resolves once the handler has finished, however the turn ended. */
  private readonly settled = new Promise<void>((resolve) => {
    this.resolveSettled = resolve;
  });

  constructor(
    private agentId: string,
    private handlers: AcpHandlers,
    private chatId?: string,
  ) {}

  static async warmup(agentId: string, chatId?: string): Promise<void> {
    const handler = new AcpStreamHandler(
      agentId,
      {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
      chatId,
    );
    await handler.ensureSession();
  }

  async start(userMessage: string, context: ContextInfo): Promise<void> {
    const chatKey = this.getChatKey();
    const previous = AcpStreamHandler.activeHandlers.get(chatKey);
    if (previous && previous !== this) {
      if (!previous.cancelRequested) {
        this.handlers.onError(
          "The agent is still answering in this chat. Stop it before sending this prompt.",
        );
        return;
      }
      // A stopped turn is winding down; it finishes within the cancel grace period.
      await previous.settled;
    }
    try {
      AcpStreamHandler.activeHandlers.set(chatKey, this);
      this.registeredChatKey = chatKey;
      await this.ensureSession();
      if (this.cancelRequested) {
        this.finishCancelled();
        return;
      }
      if (!this.activeSessionId) {
        throw new Error(`${this.agentId} did not create an active session`);
      }
      if (
        context.images?.length &&
        !this.agentStatus?.agentCapabilities?.promptCapabilities.image
      ) {
        this.fail(
          "This agent does not support image attachments. Choose an image-capable agent or remove the images.",
        );
        return;
      }
      await this.setupListeners();
      this.awaitingFirstResponse = true;
      try {
        await withTimeout(
          invoke("send_acp_prompt", {
            sessionId: this.activeSessionId,
            prompt: this.buildPrompt(userMessage, context),
          }),
          ACP_PROMPT_TIMEOUT_MS,
          `${this.agentId} did not accept the prompt in time`,
        );
      } catch (error) {
        // The prompt may still reach the agent; make sure it does not keep working unseen.
        void this.cancelOnBackend();
        throw error;
      }
      this.armStillWaitingHint();
    } catch (error) {
      if (this.cancelRequested) {
        this.finishCancelled();
        return;
      }
      console.error("ACP agent error:", error);
      this.fail(this.formatStartupError(error));
    }
  }

  /** The chat this turn runs in; turns without a chat id run in the current chat. */
  private getChatKey(): string {
    return this.chatId ?? this.getTargetChat()?.id ?? CURRENT_CHAT_KEY;
  }

  /**
   * Makes sure the chat's session is open on the agent. The agent starts when it is not running
   * in this workspace yet; a running agent only opens (or finds) the chat's session, so other
   * chats on it keep going. Opens for one chat run one at a time.
   */
  private ensureSession(): Promise<void> {
    const chatKey = this.getChatKey();
    const previous = AcpStreamHandler.sessionQueues.get(chatKey) ?? Promise.resolve();
    const open = previous.then(() => this.ensureSessionOnce());
    const settled = open.then(
      () => undefined,
      () => undefined,
    );
    AcpStreamHandler.sessionQueues.set(chatKey, settled);
    void settled.then(() => {
      if (AcpStreamHandler.sessionQueues.get(chatKey) === settled) {
        AcpStreamHandler.sessionQueues.delete(chatKey);
      }
    });
    return open;
  }

  private async ensureSessionOnce(): Promise<void> {
    try {
      const targetChat = this.getTargetChat();
      const desiredSessionId =
        targetChat?.agentId === this.agentId ? (targetChat.acpSessionId ?? null) : null;
      const workspacePath = this.getWorkspacePath();
      this.workspacePath = workspacePath;
      const store = useAIChatStore.getState();
      const isStarting = !selectAcpAgentStatus(store, this.agentId, workspacePath)?.running;

      if (isStarting) {
        console.log(`Starting agent ${this.agentId}...`);
        this.handlers.onResponsePhase?.("starting");
      }

      let opened: AcpOpenedSession;
      try {
        opened = await this.openSession(workspacePath, desiredSessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          this.cancelRequested ||
          message.includes("startup timed out") ||
          message.includes(ACP_STARTUP_STOPPED)
        ) {
          throw error;
        }
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        const agent = availableAgents.find((item) => item.id === this.agentId);
        if (!agent?.installed && agent?.canInstall) {
          await invoke<AgentConfig>("install_acp_agent", { agentId: this.agentId });
          opened = await this.openSession(workspacePath, desiredSessionId);
        } else {
          throw error;
        }
      }

      if (!opened.status.running) {
        throw new Error(`${this.agentId} failed to start`);
      }

      store.actions.setAcpAgentStatus(opened.status);
      this.agentStatus = opened.status;
      this.activeSessionId = opened.sessionId;
      if (targetChat && targetChat.acpSessionId !== opened.sessionId) {
        store.actions.setChatAcpSessionId(targetChat.id, opened.sessionId);
      }
      if (opened.contextLost) {
        toast.warning(
          `${this.agentId} could not restore this chat's earlier session, so it starts fresh without the earlier context.`,
        );
      }
      if (isStarting) {
        this.reportSkippedMcpServers(opened.status);
        this.handlers.onResponsePhase?.("waiting");
      }
      this.wasRunning = true;
    } catch (error) {
      throw new Error(`${this.agentId} is currently unavailable: ${error}`);
    }
  }

  private async openSession(
    workspacePath: string | null,
    sessionId: string | null,
  ): Promise<AcpOpenedSession> {
    try {
      return await withTimeout(
        invoke<AcpOpenedSession>("open_acp_session", {
          agentId: this.agentId,
          workspacePath,
          sessionId,
          ...(this.authMethodId ? { authMethodId: this.authMethodId } : {}),
          mcpServers: useSettingsStore
            .getState()
            .settings.mcpServers.filter((server) => server.enabled),
        }),
        ACP_START_TIMEOUT_MS,
        `${this.agentId} startup timed out`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("startup timed out")) {
        // Stop the startup that is still running so the next attempt starts clean. Other chats
        // already using the agent are not affected.
        void invoke("cancel_acp_prompt", {
          sessionId: null,
          agentId: this.agentId,
          workspacePath,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Tells the user once per agent start which configured MCP servers the agent left out. */
  private reportSkippedMcpServers(status: AcpAgentStatus) {
    const notice = formatSkippedMcpServersNotice(this.agentId, status.skippedMcpServers ?? []);
    if (notice) toast.warning(notice);
  }

  private getWorkspacePath(): string | null {
    return useProjectStore.getState().rootFolderPath ?? null;
  }

  private getTargetChat() {
    const { actions } = useAIChatStore.getState();
    if (this.chatId) {
      return actions.getChatById(this.chatId);
    }

    return actions.getCurrentChat();
  }

  private formatStartupError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const details = getAcpStartupErrorDetails(message);

    if (normalized.includes("acp protocol version")) {
      return `${this.agentId} uses a protocol version Athas does not support. Update the agent or Athas.`;
    }
    if (normalized.includes("runtime")) {
      return `${this.agentId} could not start because a required runtime is unavailable.`;
    }
    if (normalized.includes("install")) {
      return `${this.agentId} could not be installed automatically. Check network access and local tool permissions.`;
    }
    if (isAcpAuthenticationError(message) || normalized.includes("auth")) {
      const summary = `Authentication required: ${this.agentId} must be authenticated before it can answer prompts.`;
      return details ? `${summary}|||${details}` : summary;
    }
    if (normalized.includes("timed out") || normalized.includes("in time")) {
      return `${this.agentId} did not respond during startup. Restart the agent session and try again.`;
    }

    return `${this.agentId} is currently unavailable.`;
  }

  private buildPrompt(userMessage: string, context: ContextInfo): AcpPromptContentBlock[] {
    const images: AcpPromptContentBlock[] = (context.images ?? []).map((image) => ({
      type: "image",
      data: image.data,
      mimeType: image.mediaType,
    }));
    // ACP slash commands must remain the first token in the prompt.
    // If we prepend context, agents interpret them as plain text.
    if (userMessage.trimStart().startsWith("/")) {
      return [{ type: "text", text: userMessage }, ...images];
    }

    const contextPrompt = [buildContextPrompt(context), getFollowUpActionsInstruction()]
      .filter(Boolean)
      .join("\n\n");
    const blocks: AcpPromptContentBlock[] = [
      { type: "text", text: contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage },
    ];

    const supportsEmbeddedContext =
      this.agentStatus?.agentCapabilities?.promptCapabilities.embeddedContext ?? false;

    for (const file of context.mentionedFiles || []) {
      if (supportsEmbeddedContext) {
        blocks.push({
          type: "resource",
          resource: {
            uri: toAcpFileUri(file.path),
            text: file.content,
            mimeType: "text/plain",
          },
        });
      } else {
        blocks.push({
          type: "resource_link",
          uri: toAcpFileUri(file.path),
          name: getAcpPathBaseName(file.path),
          mimeType: "text/plain",
        });
      }
    }

    const resourceLinks = new Set<string>();
    for (const filePath of context.selectedProjectFiles || []) {
      if (context.mentionedFiles?.some((file) => file.path === filePath)) {
        continue;
      }
      if (resourceLinks.has(filePath)) {
        continue;
      }
      resourceLinks.add(filePath);
      blocks.push({
        type: "resource_link",
        uri: toAcpFileUri(filePath),
        name: getAcpPathBaseName(filePath),
        mimeType: "text/plain",
      });
    }

    return [...blocks, ...images];
  }

  private async setupListeners(): Promise<void> {
    this.listeners.event = await listen<AcpEvent>("acp-event", (event) => {
      this.handleAcpEvent(event.payload);
    });
  }

  private handleAcpEvent(event: AcpEvent): void {
    // After Stop, updates still apply until the agent answers session/cancel: tool calls it
    // already started report their final state on the way out.
    if (this.sessionComplete) return;
    if (event.type === "status_changed") {
      if (!this.isOwnAgent(event.status)) return;
    } else if (event.type === "elicitation_request" && event.sessionId === null) {
      // Request-scoped questions belong to no session; the running prompt's chat answers them.
    } else if (
      !hasSessionId(event) ||
      !this.activeSessionId ||
      event.sessionId !== this.activeSessionId
    ) {
      return;
    }
    this.markPromptActivity(event);
    if (event.type === "thought_chunk") {
      this.startPendingMessage();
    }
    if (this.handlers.onEvent) {
      this.handlers.onEvent(event);
    }

    switch (event.type) {
      case "user_message_chunk":
        // User echo chunk from agent; no UI mutation needed in current chat flow
        break;

      case "content_chunk":
        this.handleContentChunk(event);
        break;

      case "thought_chunk":
        // Thought chunks are surfaced through generic ACP event stream UI for now
        break;

      case "tool_start":
        this.handleToolStart(event);
        break;

      case "tool_update":
        this.handleToolUpdate(event);
        break;

      case "tool_complete":
        this.handleToolComplete(event);
        break;

      case "permission_request":
        this.handlePermissionRequest(event);
        break;

      case "session_complete":
        this.handleSessionComplete();
        break;

      case "error":
        this.handleError(event);
        break;

      case "status_changed":
        this.handleStatusChanged(event);
        break;

      case "session_mode_update":
      case "current_mode_update":
      case "slash_commands_update":
      case "config_options_update":
        // The chat store keeps each session's modes, commands and options.
        break;

      case "plan_update":
        // Plan updates are surfaced through generic ACP event stream UI for now
        break;

      case "usage_update":
        break;

      case "session_info_update":
        break;

      case "prompt_complete":
        this.handlePromptComplete(event);
        break;

      case "ui_action":
        this.handleUiAction(event);
        break;
    }
  }

  private handlePromptComplete(event: Extract<AcpEvent, { type: "prompt_complete" }>): void {
    console.log("Prompt complete:", event.stopReason);
    // After session/cancel the agent must answer `cancelled`; an agent that finished anyway
    // still ends a turn the user stopped.
    if (event.stopReason === "cancelled" || this.cancelRequested) {
      this.finishCancelled();
      return;
    }
    // Limits and refusals end the turn too; the chat explains them from the stop reason.
    this.handleSessionComplete(event.stopReason);
  }

  /** Whether `status` is about the agent process holding this turn's session. */
  private isOwnAgent(status: AcpAgentStatus): boolean {
    if (this.activeSessionId && status.sessionIds?.includes(this.activeSessionId)) return true;
    return (
      getAcpAgentKey(status.agentId, status.workspacePath) ===
      getAcpAgentKey(this.agentId, this.workspacePath)
    );
  }

  private handleStatusChanged(event: Extract<AcpEvent, { type: "status_changed" }>): void {
    if (event.status.running) {
      this.agentStatus = event.status;
      return;
    }

    // The agent went away without the user stopping it (it exited or crashed): every chat on it
    // can reconnect.
    if (this.wasRunning && !this.sessionComplete) {
      if (this.cancelRequested) {
        this.finishCancelled();
        return;
      }
      console.warn("Agent stopped unexpectedly", event.error);
      const reason = event.error ? ` (${event.error})` : "";
      this.fail(`Agent disconnected unexpectedly${reason}. Click retry to restart.`, true);
    }
  }

  private handleUiAction(event: Extract<AcpEvent, { type: "ui_action" }>): void {
    const { action } = event;
    const bufferActions = useBufferStore.getState().actions;

    switch (action.action) {
      case "open_terminal":
        console.log("Opening terminal:", action.command);
        bufferActions.openTerminalBuffer({
          command: action.command ?? undefined,
          name: action.command ?? undefined,
        });
        break;

      case "set_chat_title": {
        const targetChat = this.getTargetChat();
        const nextTitle = targetChat
          ? getChatTitleFromSessionInfo(targetChat.title, action.title)
          : null;
        if (targetChat && nextTitle) {
          useAIChatStore.getState().actions.updateChatTitle(targetChat.id, nextTitle);
        }
        break;
      }
    }
  }

  private handleContentChunk(event: Extract<AcpEvent, { type: "content_chunk" }>): void {
    this.startPendingMessage();

    if (event.content.type === "text") {
      this.handlers.onChunk(event.content.text);
    } else if (event.content.type === "image") {
      if (this.handlers.onImageChunk) {
        this.handlers.onImageChunk(event.content.data, event.content.mediaType);
      }
    } else if (event.content.type === "resource") {
      if (this.handlers.onResourceChunk) {
        this.handlers.onResourceChunk(event.content.uri, event.content.name);
      }
    }

    if (event.isComplete) {
      // Content block is complete, but session may continue
      console.log("Content block complete");
    }
  }

  private startPendingMessage(): void {
    if (!this.pendingNewMessage) return;
    this.pendingNewMessage = false;
    this.handlers.onResponseContinuation?.();
  }

  private handleToolStart(event: Extract<AcpEvent, { type: "tool_start" }>): void {
    this.activeTools.set(event.toolId, event.toolName);
    if (this.handlers.onToolUse) {
      this.handlers.onToolUse(event);
    }
  }

  private handleToolUpdate(event: Extract<AcpEvent, { type: "tool_update" }>): void {
    if (event.toolName) {
      this.activeTools.set(event.toolId, event.toolName);
    }
    if (this.handlers.onToolUpdate) {
      this.handlers.onToolUpdate(event);
    }
  }

  private handleToolComplete(event: Extract<AcpEvent, { type: "tool_complete" }>): void {
    const toolName = this.activeTools.get(event.toolId);
    if (this.handlers.onToolComplete) {
      // The id is what the transcript matches on; a missing name must not
      // strand the call in its running state.
      this.handlers.onToolComplete(
        toolName ?? "tool",
        event.toolId,
        event.output,
        event.error ?? undefined,
      );
    }
    this.activeTools.delete(event.toolId);
    this.pendingNewMessage = true;

    if (!event.success) {
      console.debug("Tool call failed:", {
        toolId: event.toolId,
        toolName,
        error: event.error,
      });
    }
  }

  private handlePermissionRequest(event: Extract<AcpEvent, { type: "permission_request" }>): void {
    if (this.handlers.onPermissionRequest) {
      this.handlers.onPermissionRequest(event);
    } else {
      // Auto-reject if no handler for safety - prevents unintended actions
      console.error(
        "Permission request received but no handler set, auto-rejecting for safety:",
        event.description,
      );
      AcpStreamHandler.respondToPermission(event.requestId, false).catch(console.error);
    }
  }

  private handleSessionComplete(stopReason?: AcpStopReason): void {
    if (this.sessionComplete) return;
    if (this.cancelRequested) {
      this.finishCancelled();
      return;
    }
    console.log("Session complete");
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete(
      stopReason ? { outcome: "completed", stopReason } : { outcome: "completed" },
    );
  }

  private handleError(event: Extract<AcpEvent, { type: "error" }>): void {
    if (this.sessionComplete) return;
    if (this.cancelRequested) {
      this.finishCancelled();
      return;
    }
    console.error("ACP error:", event.error);
    this.fail(event.error);
  }

  private markPromptActivity(event: AcpEvent): void {
    if (!this.awaitingFirstResponse) return;

    switch (event.type) {
      case "user_message_chunk":
      case "content_chunk":
      case "thought_chunk":
      case "tool_start":
      case "tool_update":
      case "tool_complete":
      case "permission_request":
      case "elicitation_request":
      case "session_complete":
      case "error":
      case "plan_update":
      case "prompt_complete":
      case "ui_action":
        this.awaitingFirstResponse = false;
        this.clearStillWaitingHint();
        break;
    }
  }

  private armStillWaitingHint(): void {
    if (!this.awaitingFirstResponse || this.sessionComplete || this.cancelRequested) return;

    this.stillWaitingTimeout = setTimeout(() => {
      this.stillWaitingTimeout = null;
      if (this.awaitingFirstResponse && !this.sessionComplete && !this.cancelRequested) {
        this.handlers.onResponsePhase?.("stalled");
      }
    }, ACP_STILL_WAITING_MS);
  }

  private clearStillWaitingHint(): void {
    if (this.stillWaitingTimeout) {
      clearTimeout(this.stillWaitingTimeout);
      this.stillWaitingTimeout = null;
    }
  }

  private fail(error: string, canReconnect?: boolean): void {
    if (this.sessionComplete) return;
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onError(error, canReconnect);
  }

  private cleanup(): void {
    console.log("Cleaning up ACP listeners...");
    this.awaitingFirstResponse = false;
    this.clearStillWaitingHint();
    if (this.cancelGraceTimeout) {
      clearTimeout(this.cancelGraceTimeout);
      this.cancelGraceTimeout = null;
    }
    this.pendingNewMessage = false;
    this.activeTools.clear();

    if (this.listeners.event) {
      this.listeners.event();
      this.listeners.event = undefined;
    }

    if (
      this.registeredChatKey !== null &&
      AcpStreamHandler.activeHandlers.get(this.registeredChatKey) === this
    ) {
      AcpStreamHandler.activeHandlers.delete(this.registeredChatKey);
    }
    this.resolveSettled();
  }

  /** Stop was pressed: keep applying updates until the agent ends the turn, but not forever. */
  private requestCancel(): void {
    if (this.sessionComplete || this.cancelRequested) return;
    this.cancelRequested = true;
    this.clearStillWaitingHint();
    this.cancelGraceTimeout = setTimeout(() => this.finishCancelled(), ACP_CANCEL_GRACE_MS);
  }

  private finishCancelled(): void {
    if (this.sessionComplete) return;
    this.cancelRequested = true;
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete({ outcome: "cancelled" });
  }

  /** Ends the turn now, for when the agent itself is being stopped. */
  private forceStop(): void {
    this.finishCancelled();
  }

  /** Cancels this turn on the bridge: its session's turn, or the agent's startup before then. */
  private cancelOnBackend(): Promise<void> {
    return AcpStreamHandler.cancelOnBackend({
      sessionId: this.activeSessionId,
      agentId: this.agentId,
      workspacePath: this.workspacePath ?? this.getWorkspacePath(),
    });
  }

  private static async cancelOnBackend(target: {
    sessionId: string | null;
    agentId: string | null;
    workspacePath: string | null;
  }): Promise<void> {
    try {
      await invoke("cancel_acp_prompt", target);
    } catch (error) {
      console.error("Failed to cancel ACP prompt on backend:", error);
    }
  }

  private static currentWorkspacePath(): string | null {
    return useProjectStore.getState().rootFolderPath ?? null;
  }

  // Static method to respond to permission requests
  static async respondToPermission(
    requestId: string,
    approved: boolean,
    cancelled = false,
    optionId?: string,
  ): Promise<void> {
    await invoke("respond_acp_permission", {
      args: { requestId, approved, cancelled, optionId },
    });
  }

  /** Answers an agent's `elicitation/create` request. */
  static async respondToElicitation(
    requestId: string,
    response: AcpElicitationResponse,
  ): Promise<void> {
    await invoke("respond_acp_elicitation", { requestId, response });
  }

  // Static method to get available agents
  static async getAvailableAgents(): Promise<
    Array<{
      id: string;
      name: string;
      binaryName: string;
      installed: boolean;
    }>
  > {
    return invoke("get_available_agents");
  }

  static async listSessions(args: {
    agentId: string;
    workspacePath?: string | null;
    cwd?: string;
    cursor?: string | null;
  }): Promise<AcpSessionList> {
    return invoke<AcpSessionList>("list_acp_sessions", {
      args: {
        agentId: args.agentId,
        workspacePath: args.workspacePath ?? AcpStreamHandler.currentWorkspacePath(),
        cwd: args.cwd,
        cursor: args.cursor ?? undefined,
      },
    });
  }

  static async deleteSession(agentId: string, sessionId: string): Promise<void> {
    await invoke("delete_acp_session", {
      args: { agentId, workspacePath: AcpStreamHandler.currentWorkspacePath(), sessionId },
    });
  }

  /**
   * Lets go of a chat's session, for when the chat is deleted. The agent closes it when it
   * supports `session/close` and keeps running for other chats.
   */
  static async closeSession(sessionId: string): Promise<void> {
    await invoke("close_acp_session", { sessionId });
    useAIChatStore.getState().actions.clearAcpSession(sessionId);
  }

  /**
   * Logs out of the agent. Athas then leaves sign-in to the user: the next prompt that needs it
   * shows the agent's sign-in methods.
   */
  static async logoutAgent(agentId: string): Promise<void> {
    await invoke("logout_acp_agent", {
      agentId,
      workspacePath: AcpStreamHandler.currentWorkspacePath(),
    });
  }

  /**
   * Signs in with an `agent` method the user picked. A running agent authenticates in place;
   * otherwise the agent starts again and authenticates when its session asks for it.
   */
  static async authenticateAgent(
    agentId: string,
    chatId: string | null | undefined,
    methodId: string,
  ): Promise<void> {
    const workspacePath = AcpStreamHandler.currentWorkspacePath();
    const agentKey = getAcpAgentKey(agentId, workspacePath);
    const statuses = await invoke<AcpAgentStatus[]>("get_acp_status");
    const isRunning = statuses.some(
      (status) =>
        status.running && getAcpAgentKey(status.agentId, status.workspacePath) === agentKey,
    );
    if (isRunning) {
      await invoke("authenticate_acp_agent", { agentId, workspacePath, methodId });
      return;
    }

    const handler = new AcpStreamHandler(
      agentId,
      { onChunk: () => {}, onComplete: () => {}, onError: () => {} },
      chatId ?? undefined,
    );
    handler.authMethodId = methodId;
    await handler.ensureSession();
  }

  /**
   * Starts the agent again and reopens the chat's session, for after the user signed in outside
   * the agent's connection (a terminal sign-in). Every chat on the agent reconnects.
   */
  static async reconnectAgent(agentId: string, chatId?: string | null): Promise<void> {
    await AcpStreamHandler.stopAgent(agentId);
    await AcpStreamHandler.warmup(agentId, chatId ?? undefined);
  }

  /** Stops the agent and starts it again with a fresh session for the chat. */
  static async restartAgent(agentId: string, chatId?: string | null): Promise<void> {
    await AcpStreamHandler.stopAgent(agentId);

    const actions = useAIChatStore.getState().actions;
    const chat = chatId ? actions.getChatById(chatId) : undefined;
    if (chatId) {
      actions.setChatAcpSessionId(chatId, null);
    }
    if (chat?.acpSessionId) {
      actions.clearAcpSession(chat.acpSessionId);
    }

    await AcpStreamHandler.warmup(agentId, chatId ?? undefined);
  }

  /**
   * Stops the agent process for `agentId` in the current workspace. Every chat on it ends its
   * turn; other agents keep running.
   */
  static async stopAgent(agentId: string): Promise<void> {
    for (const handler of AcpStreamHandler.activeHandlers.values()) {
      if (handler.agentId === agentId) handler.forceStop();
    }
    await invoke("stop_acp_agent", {
      agentId,
      workspacePath: AcpStreamHandler.currentWorkspacePath(),
    });
  }

  /**
   * Cancels the prompt turn in a chat (the current chat without an id). The bridge sends
   * session/cancel for that chat's session only and answers its open permission requests and
   * questions as cancelled; the chat keeps applying the agent's last updates until it ends the
   * turn. Before the chat has a session, the agent's startup is stopped instead.
   */
  static async cancelPrompt(chatId?: string | null): Promise<void> {
    const actions = useAIChatStore.getState().actions;
    const chat = chatId ? actions.getChatById(chatId) : actions.getCurrentChat();
    const handler = AcpStreamHandler.activeHandlers.get(chatId ?? chat?.id ?? CURRENT_CHAT_KEY);
    if (handler) {
      handler.requestCancel();
      await handler.cancelOnBackend();
      return;
    }
    await AcpStreamHandler.cancelOnBackend({
      sessionId: chat?.acpSessionId ?? null,
      agentId: chat?.agentId ?? null,
      workspacePath: AcpStreamHandler.currentWorkspacePath(),
    });
  }
}

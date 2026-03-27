import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getChatPreferredAcpModeId } from "@/features/ai/lib/chat-acp-state";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus, AcpEvent } from "@/features/ai/types/acp";
import type { AIChatSurface, ChatScopeId } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/stores/project-store";
import { buildContextPrompt } from "./context-builder";
import type { ContextInfo } from "./types";

interface AcpHandlers {
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
  resumeKey?: string;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: unknown, toolId?: string) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
  onImageChunk?: (data: string, mediaType: string) => void;
  onResourceChunk?: (uri: string, name: string | null) => void;
}

interface AcpListeners {
  event?: () => void;
}

interface AcpBootstrapContext {
  conversationHistory: AIMessage[];
}

export class AcpStreamHandler {
  private static activeHandlers = new Map<ChatScopeId, AcpStreamHandler>();
  private static lastSessionIdByKey = new Map<string, string>();
  private static readonly TERMINAL_SETTLE_DELAY_MS = 100;
  private listeners: AcpListeners = {};
  private timeout?: NodeJS.Timeout;
  private terminalSettleTimeout?: NodeJS.Timeout;
  private lastActivityTime = Date.now();
  private hasObservedResponseActivity = false;
  private activeTools = new Map<string, string>();
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;
  private wasRunning = false;
  private sessionId: string | null = null;
  private readonly surface: AIChatSurface;
  private readonly scopeId: ChatScopeId;
  private readonly resumeKey: string;

  constructor(
    private agentId: string,
    private handlers: AcpHandlers,
  ) {
    this.surface = handlers.surface ?? "panel";
    this.scopeId = handlers.scopeId ?? "panel";
    this.resumeKey = handlers.resumeKey ?? this.scopeId;
  }

  async start(
    userMessage: string,
    context: ContextInfo,
    conversationHistory?: AIMessage[],
  ): Promise<void> {
    try {
      AcpStreamHandler.activeHandlers.set(this.scopeId, this);
      await this.setupListeners();
      await this.ensureAgentRunning(conversationHistory);
      const fullMessage = this.buildMessage(userMessage, context);
      await invoke("send_acp_prompt", { prompt: fullMessage, routeKey: this.resumeKey });
      this.setupTimeout();
    } catch (error) {
      console.error("ACP agent error:", error);
      this.cleanup();
      this.handlers.onError(
        error instanceof Error ? error.message : `${this.agentId} is currently unavailable`,
      );
    }
  }

  private async ensureAgentRunning(conversationHistory?: AIMessage[]): Promise<void> {
    try {
      const status = await invoke<AcpAgentStatus>("get_acp_status", { routeKey: this.resumeKey });
      const cachedChatSessionId = this.normalizeResumeSessionId(
        useAIChatStore.getState().getCurrentChat(this.scopeId)?.acpState?.runtimeState?.sessionId ??
          null,
      );
      const desiredSessionId =
        this.normalizeResumeSessionId(AcpStreamHandler.lastSessionIdByKey.get(this.resumeKey)) ??
        cachedChatSessionId;
      this.setSessionId(desiredSessionId);
      const shouldReuseRunningSession =
        status.running &&
        status.agentId === this.agentId &&
        (!desiredSessionId || status.sessionId === desiredSessionId);

      if (!shouldReuseRunningSession) {
        console.log(`Starting agent ${this.agentId}...`);

        // Get current workspace path if available
        const workspacePath = this.getWorkspacePath();
        const freshSession = desiredSessionId === null;
        const bootstrap: AcpBootstrapContext | null =
          freshSession && conversationHistory && conversationHistory.length > 0
            ? { conversationHistory }
            : null;

        const startStatus = await invoke<AcpAgentStatus>("start_acp_agent", {
          agentId: this.agentId,
          workspacePath,
          sessionId: desiredSessionId,
          freshSession,
          bootstrap,
          routeKey: this.resumeKey,
        });

        if (!startStatus.running) {
          throw new Error(`${this.agentId} failed to start`);
        }

        if (startStatus.sessionId) {
          this.setSessionId(startStatus.sessionId);
        }
        this.wasRunning = true;

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (freshSession) {
          await this.applyPreferredSessionMode();
        }
      } else {
        this.setSessionId(status.sessionId ?? desiredSessionId);
        this.wasRunning = true;
      }
    } catch (error) {
      throw new Error(`${this.agentId} is currently unavailable: ${error}`);
    }
  }

  private getWorkspacePath(): string | null {
    return useProjectStore.getState().rootFolderPath ?? null;
  }

  private normalizeResumeSessionId(sessionId: unknown): string | null {
    if (typeof sessionId !== "string") {
      return null;
    }

    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId || normalizedSessionId.startsWith("pi:")) {
      return null;
    }

    return normalizedSessionId;
  }

  private getPreferredSessionModeId(): string | null {
    const currentChat = useAIChatStore.getState().getCurrentChat(this.scopeId);
    const defaultModeId = useSettingsStore.getState().settings.aiDefaultSessionMode;
    return getChatPreferredAcpModeId(currentChat, defaultModeId);
  }

  private async applyPreferredSessionMode(): Promise<void> {
    const preferredModeId = this.getPreferredSessionModeId();
    if (!preferredModeId) {
      return;
    }

    try {
      await invoke("set_acp_session_mode", { modeId: preferredModeId, routeKey: this.resumeKey });
    } catch (error) {
      console.warn("Failed to apply preferred ACP mode:", error);
    }
  }

  private buildMessage(userMessage: string, context: ContextInfo): string {
    const contextPrompt = buildContextPrompt(context);
    const sections = [contextPrompt, userMessage].filter(Boolean);
    return sections.join("\n\n");
  }

  private setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
    if (!sessionId) return;

    AcpStreamHandler.lastSessionIdByKey.set(this.resumeKey, sessionId);
  }

  private shouldHandleEvent(event: AcpEvent): boolean {
    if (event.routeKey !== this.resumeKey) {
      return false;
    }

    if (
      event.type === "runtime_state_update" &&
      event.runtimeState.sessionId &&
      event.runtimeState.sessionId !== this.sessionId
    ) {
      return true;
    }

    if ("sessionId" in event && event.sessionId) {
      if (!this.sessionId) {
        this.setSessionId(event.sessionId);
      }
      return !this.sessionId || event.sessionId === this.sessionId;
    }

    return true;
  }

  private async setupListeners(): Promise<void> {
    this.listeners.event = await listen<AcpEvent>("acp-event", (event) => {
      this.handleAcpEvent(event.payload);
    });
  }

  private handleAcpEvent(event: AcpEvent): void {
    if (this.cancelled || !this.shouldHandleEvent(event)) return;
    console.log("ACP event:", event.type);
    if (this.handlers.onEvent) {
      this.handlers.onEvent(event);
    }

    this.lastActivityTime = Date.now();

    switch (event.type) {
      case "user_message_chunk":
        // User echo chunk from agent; no UI mutation needed in current chat flow
        break;

      case "content_chunk":
        this.handleContentChunk(event);
        break;

      case "thought_chunk":
        this.hasObservedResponseActivity = true;
        break;

      case "tool_start":
        this.handleToolStart(event);
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
        this.handleSessionModeUpdate(event);
        break;

      case "current_mode_update":
        this.handleCurrentModeUpdate(event);
        break;

      case "slash_commands_update":
        useAIChatStore.getState().setAvailableSlashCommands(event.commands, this.scopeId);
        break;

      case "plan_update":
        this.hasObservedResponseActivity = true;
        // Plan updates are surfaced through generic ACP event stream UI for now
        break;

      case "runtime_state_update":
        this.handleRuntimeStateUpdate(event);
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
    // Mark session as complete - this will call the handlers appropriately
    // The stop reason can be used to determine how to handle the completion
    if (event.stopReason === "cancelled") {
      // User cancelled the prompt
      this.cleanup();
      this.handlers.onComplete();
      return;
    }

    if (event.stopReason === "max_tokens") {
      this.cleanup();
      this.handlers.onError("ACP context window exceeded");
      return;
    }

    // Give trailing content chunks a brief chance to arrive before finalizing.
    this.scheduleTerminalCompletion();
  }

  private handleSessionModeUpdate(event: Extract<AcpEvent, { type: "session_mode_update" }>): void {
    console.log("Session mode state updated:", event.modeState);
    useAIChatStore
      .getState()
      .setSessionModeState(
        event.modeState.currentModeId,
        event.modeState.availableModes,
        this.scopeId,
      );
  }

  private handleCurrentModeUpdate(event: Extract<AcpEvent, { type: "current_mode_update" }>): void {
    console.log("Current mode changed:", event.currentModeId);
    useAIChatStore.getState().setCurrentModeId(event.currentModeId, this.scopeId);
  }

  private handleStatusChanged(event: Extract<AcpEvent, { type: "status_changed" }>): void {
    console.log("Agent status changed:", event.status);

    if (event.status.running && event.status.sessionId) {
      this.setSessionId(event.status.sessionId);
    }

    if (!event.status.running) {
      useAIChatStore.getState().markPendingAcpPermissionsStale(this.scopeId);
      useAIChatStore.getState().hydrateAcpStateFromCurrentChat(this.scopeId);
    }

    // Detect unexpected agent crash: was running but now stopped without user action
    if (this.wasRunning && !event.status.running && !this.sessionComplete && !this.cancelled) {
      console.warn("Agent crashed unexpectedly");
      this.cleanup();
      // Pass canReconnect=true to indicate the error is recoverable
      this.handlers.onError("Agent disconnected unexpectedly. Click retry to restart.", true);
    }
  }

  private handleRuntimeStateUpdate(
    event: Extract<AcpEvent, { type: "runtime_state_update" }>,
  ): void {
    if (event.runtimeState.sessionId) {
      this.setSessionId(event.runtimeState.sessionId);
    }

    useAIChatStore.getState().setAcpRuntimeState(event.runtimeState, this.scopeId);
  }

  private handleUiAction(event: Extract<AcpEvent, { type: "ui_action" }>): void {
    const { action } = event;
    const bufferActions = useBufferStore.getState().actions;

    switch (action.action) {
      case "open_web_viewer":
        console.log("Opening web viewer:", action.url);
        bufferActions.openWebViewerBuffer(action.url);
        break;

      case "open_terminal":
        console.log("Opening terminal:", action.command);
        bufferActions.openTerminalBuffer({
          command: action.command ?? undefined,
          name: action.command ?? undefined,
        });
        break;
    }
  }

  private handleContentChunk(event: Extract<AcpEvent, { type: "content_chunk" }>): void {
    this.hasObservedResponseActivity = true;
    if (this.pendingNewMessage && this.handlers.onNewMessage) {
      this.handlers.onNewMessage();
    }
    this.pendingNewMessage = false;

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

  private handleToolStart(event: Extract<AcpEvent, { type: "tool_start" }>): void {
    this.hasObservedResponseActivity = true;
    this.activeTools.set(event.toolId, event.toolName);
    if (this.handlers.onToolUse) {
      this.handlers.onToolUse(event.toolName, event.input, event.toolId);
    }
  }

  private handleToolComplete(event: Extract<AcpEvent, { type: "tool_complete" }>): void {
    this.hasObservedResponseActivity = true;
    const toolName = this.activeTools.get(event.toolId);
    if (toolName && this.handlers.onToolComplete) {
      const toolError =
        event.success === false
          ? typeof event.output === "string"
            ? event.output
            : "Tool failed"
          : undefined;
      this.handlers.onToolComplete(toolName, event.toolId, event.output, toolError);
    }
    this.activeTools.delete(event.toolId);
    this.pendingNewMessage = true;

    if (!event.success) {
      console.warn("Tool call failed:", event.toolId);
    }
  }

  private handlePermissionRequest(event: Extract<AcpEvent, { type: "permission_request" }>): void {
    this.hasObservedResponseActivity = true;
    if (this.handlers.onPermissionRequest) {
      this.handlers.onPermissionRequest(event);
    } else {
      // Auto-reject if no handler for safety - prevents unintended actions
      console.error(
        "Permission request received but no handler set, auto-rejecting for safety:",
        event.description,
      );
      AcpStreamHandler.respondToPermission(event.requestId, false, false, this.scopeId).catch(
        console.error,
      );
    }
  }

  private handleSessionComplete(): void {
    console.log("Session complete");
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete();
  }

  private scheduleTerminalCompletion(): void {
    if (this.sessionComplete || this.cancelled) {
      return;
    }

    if (this.terminalSettleTimeout) {
      clearTimeout(this.terminalSettleTimeout);
    }

    this.terminalSettleTimeout = setTimeout(() => {
      this.terminalSettleTimeout = undefined;
      if (this.sessionComplete || this.cancelled) {
        return;
      }
      this.handleSessionComplete();
    }, AcpStreamHandler.TERMINAL_SETTLE_DELAY_MS);
  }

  private scheduleTerminalError(error: string, canReconnect?: boolean): void {
    if (this.sessionComplete || this.cancelled) {
      return;
    }

    if (this.terminalSettleTimeout) {
      clearTimeout(this.terminalSettleTimeout);
    }

    this.terminalSettleTimeout = setTimeout(() => {
      this.terminalSettleTimeout = undefined;
      if (this.sessionComplete || this.cancelled) {
        return;
      }

      this.pendingNewMessage = false;
      this.cleanup();
      this.handlers.onError(error, canReconnect);
    }, AcpStreamHandler.TERMINAL_SETTLE_DELAY_MS);
  }

  private handleError(event: Extract<AcpEvent, { type: "error" }>): void {
    console.error("ACP error:", event.error);
    // Give trailing content chunks a brief chance to arrive before surfacing the error.
    this.scheduleTerminalError(event.error);
  }

  private setupTimeout(): void {
    const checkInactivity = () => {
      const now = Date.now();
      const inactiveTime = now - this.lastActivityTime;

      // If session is already complete, don't check timeout
      if (this.sessionComplete) {
        return;
      }

      // Only auto-complete once the agent has produced real response activity.
      if (this.hasObservedResponseActivity && inactiveTime > 10000 && this.activeTools.size === 0) {
        console.log("No activity for 10 seconds, conversation appears complete");
        this.cleanup();
        this.handlers.onComplete();
        return;
      }

      // If still processing tool but no activity for 60 seconds, timeout
      if (inactiveTime > 60000) {
        console.log("Timeout: No activity for 60 seconds");
        this.cleanup();
        this.handlers.onError("Request timed out - no activity");
        return;
      }

      // Continue checking
      this.timeout = setTimeout(checkInactivity, 1000);
    };

    this.timeout = setTimeout(checkInactivity, 1000);
  }

  private cleanup(): void {
    console.log("Cleaning up ACP listeners...");

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.terminalSettleTimeout) {
      clearTimeout(this.terminalSettleTimeout);
      this.terminalSettleTimeout = undefined;
    }
    this.pendingNewMessage = false;
    this.hasObservedResponseActivity = false;
    this.activeTools.clear();

    if (this.listeners.event) {
      this.listeners.event();
      this.listeners.event = undefined;
    }

    if (AcpStreamHandler.activeHandlers.get(this.scopeId) === this) {
      AcpStreamHandler.activeHandlers.delete(this.scopeId);
    }
  }

  private forceStop(): void {
    if (this.sessionComplete || this.cancelled) return;
    this.cancelled = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete();
  }

  // Static method to respond to permission requests
  static async respondToPermission(
    requestId: string,
    approved: boolean,
    cancelled = false,
    scopeId: ChatScopeId = "panel",
    value?: string | null,
  ): Promise<void> {
    await invoke("respond_acp_permission", {
      args: { requestId, approved, cancelled, routeKey: scopeId, value },
    });
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

  static async getStatus(scopeId: ChatScopeId = "panel"): Promise<AcpAgentStatus> {
    return invoke("get_acp_status", { routeKey: scopeId });
  }

  static async changeSessionMode(modeId: string, scopeId: ChatScopeId = "panel"): Promise<void> {
    await invoke("set_acp_session_mode", { modeId, routeKey: scopeId });
  }

  // Static method to stop the current agent
  static async stopAgent(scopeId: ChatScopeId = "panel"): Promise<void> {
    AcpStreamHandler.activeHandlers.get(scopeId)?.forceStop();
    AcpStreamHandler.lastSessionIdByKey.delete(scopeId);
    await invoke("stop_acp_agent", { routeKey: scopeId });
  }

  // Static method to cancel the current prompt turn
  static async cancelPrompt(scopeId?: ChatScopeId): Promise<void> {
    const routeKey = scopeId ?? "panel";
    AcpStreamHandler.activeHandlers.get(routeKey)?.forceStop();

    try {
      await invoke("cancel_acp_prompt", { routeKey });
    } catch (error) {
      console.error("Failed to cancel ACP prompt on backend:", error);
    }
  }
}

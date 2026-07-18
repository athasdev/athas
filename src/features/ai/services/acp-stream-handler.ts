import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type {
  AcpAgentStatus,
  AcpEvent,
  AcpPromptContentBlock,
  AcpSessionList,
  AgentConfig,
} from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { getAcpPathBaseName, toAcpFileUri } from "@/features/ai/lib/acp-file-uri";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
import { normalizeAcpWorkspacePath } from "@/features/ai/lib/acp-workspace-path";
import { getFollowUpActionsInstruction } from "@/features/ai/lib/follow-up-actions";
import { buildContextPrompt } from "../utils/ai-context-builder";

interface AcpHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onNewMessage?: () => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolUpdate?: (event: Extract<AcpEvent, { type: "tool_update" }>) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
  onImageChunk?: (data: string, mediaType: string) => void;
  onResourceChunk?: (uri: string, name: string | null) => void;
}

interface AcpListeners {
  event?: () => void;
}

const ACP_STATUS_TIMEOUT_MS = 5_000;
const ACP_START_TIMEOUT_MS = 15_000;
const ACP_PROMPT_TIMEOUT_MS = 10_000;
const ACP_FIRST_RESPONSE_TIMEOUT_MS = 20_000;

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

export class AcpStreamHandler {
  private static activeHandler: AcpStreamHandler | null = null;
  private static startupQueue: Promise<void> = Promise.resolve();
  private listeners: AcpListeners = {};
  private activeTools = new Map<string, string>();
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;
  private wasRunning = false;
  private activeSessionId: string | null = null;
  private awaitingFirstResponse = false;
  private firstResponseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private agentId: string,
    private handlers: AcpHandlers,
    private chatId?: string,
  ) {}

  static async warmup(agentId: string, chatId: string): Promise<void> {
    const handler = new AcpStreamHandler(
      agentId,
      {
        onChunk: () => {},
        onComplete: () => {},
        onError: () => {},
      },
      chatId,
    );
    await handler.ensureAgentRunning();
  }

  async start(userMessage: string, context: ContextInfo): Promise<void> {
    try {
      AcpStreamHandler.activeHandler = this;
      await this.setupListeners();
      await this.ensureAgentRunning();
      this.awaitingFirstResponse = true;
      await withTimeout(
        invoke("send_acp_prompt", { prompt: this.buildPrompt(userMessage, context) }),
        ACP_PROMPT_TIMEOUT_MS,
        `${this.agentId} did not accept the prompt in time`,
      );
      this.armFirstResponseTimeout();
    } catch (error) {
      console.error("ACP agent error:", error);
      this.fail(this.formatStartupError(error));
    }
  }

  private ensureAgentRunning(): Promise<void> {
    const startup = AcpStreamHandler.startupQueue.then(() => this.ensureAgentRunningOnce());
    AcpStreamHandler.startupQueue = startup.catch(() => undefined);
    return startup;
  }

  private async ensureAgentRunningOnce(): Promise<void> {
    try {
      const status = await withTimeout(
        invoke<AcpAgentStatus>("get_acp_status"),
        ACP_STATUS_TIMEOUT_MS,
        "Agent status check timed out",
      );
      const targetChat = this.getTargetChat();
      const desiredSessionId =
        targetChat?.agentId === this.agentId ? (targetChat.acpSessionId ?? null) : null;
      const workspacePath = this.getWorkspacePath();
      const statusWorkspacePath = normalizeAcpWorkspacePath(status.workspacePath);
      const desiredWorkspacePath = normalizeAcpWorkspacePath(workspacePath);
      const shouldRestartForSession =
        status.running &&
        status.agentId === this.agentId &&
        (status.sessionId ?? null) !== desiredSessionId;
      const shouldRestartForWorkspace =
        status.running &&
        status.agentId === this.agentId &&
        statusWorkspacePath !== desiredWorkspacePath;

      if (status.running) {
        useAIChatStore.getState().setAcpStatus(status);
        this.activeSessionId = status.sessionId ?? null;
      }

      if (
        !status.running ||
        status.agentId !== this.agentId ||
        shouldRestartForSession ||
        shouldRestartForWorkspace
      ) {
        console.log(`Starting agent ${this.agentId}...`);

        let startStatus: AcpAgentStatus;
        try {
          startStatus = await withTimeout(
            invoke<AcpAgentStatus>("start_acp_agent", {
              agentId: this.agentId,
              workspacePath,
              sessionId: desiredSessionId,
            }),
            ACP_START_TIMEOUT_MS,
            `${this.agentId} startup timed out`,
          );
        } catch (error) {
          if (error instanceof Error && error.message.includes("startup timed out")) {
            throw error;
          }
          const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
          const agent = availableAgents.find((item) => item.id === this.agentId);
          if (!agent?.installed && agent?.canInstall) {
            await invoke<AgentConfig>("install_acp_agent", { agentId: this.agentId });
            startStatus = await withTimeout(
              invoke<AcpAgentStatus>("start_acp_agent", {
                agentId: this.agentId,
                workspacePath,
                sessionId: desiredSessionId,
              }),
              ACP_START_TIMEOUT_MS,
              `${this.agentId} startup timed out`,
            );
          } else {
            throw error;
          }
        }

        if (!startStatus.running) {
          throw new Error(`${this.agentId} failed to start`);
        }

        useAIChatStore.getState().setAcpStatus(startStatus);
        this.activeSessionId = startStatus.sessionId ?? null;

        if (startStatus.sessionId) {
          if (targetChat) {
            useAIChatStore.getState().setChatAcpSessionId(targetChat.id, startStatus.sessionId);
          }
        }

        this.wasRunning = true;

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        this.activeSessionId = status.sessionId ?? null;
        this.wasRunning = true;
      }
    } catch (error) {
      throw new Error(`${this.agentId} is currently unavailable: ${error}`);
    }
  }

  private getWorkspacePath(): string | null {
    return useProjectStore.getState().rootFolderPath ?? null;
  }

  private getTargetChat() {
    const store = useAIChatStore.getState();
    if (this.chatId) {
      return store.getChatById(this.chatId);
    }

    return store.getCurrentChat();
  }

  private formatStartupError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();

    if (normalized.includes("runtime")) {
      return `${this.agentId} could not start because a required runtime is unavailable.`;
    }
    if (normalized.includes("install")) {
      return `${this.agentId} could not be installed automatically. Check network access and local tool permissions.`;
    }
    if (normalized.includes("auth")) {
      return `${this.agentId} requires authentication before it can answer prompts.`;
    }
    if (normalized.includes("timed out") || normalized.includes("in time")) {
      return `${this.agentId} did not respond during startup. Restart the agent session and try again.`;
    }

    return `${this.agentId} is currently unavailable.`;
  }

  private buildPrompt(userMessage: string, context: ContextInfo): AcpPromptContentBlock[] {
    // ACP slash commands must remain the first token in the prompt.
    // If we prepend context, agents interpret them as plain text.
    if (userMessage.trimStart().startsWith("/")) {
      return [{ type: "text", text: userMessage }];
    }

    const contextPrompt = [buildContextPrompt(context), getFollowUpActionsInstruction()]
      .filter(Boolean)
      .join("\n\n");
    const blocks: AcpPromptContentBlock[] = [
      { type: "text", text: contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage },
    ];

    const supportsEmbeddedContext =
      useAIChatStore.getState().acpStatus?.agentCapabilities?.promptCapabilities.embeddedContext ??
      false;

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

    return blocks;
  }

  private async setupListeners(): Promise<void> {
    this.listeners.event = await listen<AcpEvent>("acp-event", (event) => {
      this.handleAcpEvent(event.payload);
    });
  }

  private handleAcpEvent(event: AcpEvent): void {
    if (this.cancelled) return;
    if (hasSessionId(event) && this.activeSessionId && event.sessionId !== this.activeSessionId) {
      return;
    }
    this.markPromptActivity(event);
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
        this.handleSessionModeUpdate(event);
        break;

      case "current_mode_update":
        this.handleCurrentModeUpdate(event);
        break;

      case "slash_commands_update":
        // Handle slash commands update
        useAIChatStore.getState().setAvailableSlashCommands(event.commands);
        break;

      case "config_options_update":
        useAIChatStore.getState().setSessionConfigOptions(event.configOptions);
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
    // Mark session as complete - this will call the handlers appropriately
    // The stop reason can be used to determine how to handle the completion
    if (event.stopReason === "cancelled") {
      // User cancelled the prompt
      this.cleanup();
      this.handlers.onComplete();
      return;
    }
    // Treat all other stop reasons as completion in case no session_complete arrives
    this.handleSessionComplete();
  }

  private handleSessionModeUpdate(event: Extract<AcpEvent, { type: "session_mode_update" }>): void {
    console.log("Session mode state updated:", event.modeState);
    useAIChatStore
      .getState()
      .setSessionModeState(event.modeState.currentModeId, event.modeState.availableModes);
  }

  private handleCurrentModeUpdate(event: Extract<AcpEvent, { type: "current_mode_update" }>): void {
    console.log("Current mode changed:", event.currentModeId);
    useAIChatStore.getState().setCurrentModeId(event.currentModeId);
  }

  private handleStatusChanged(event: Extract<AcpEvent, { type: "status_changed" }>): void {
    console.log("Agent status changed:", event.status);
    useAIChatStore.getState().setAcpStatus(event.status);
    if (event.status.agentId === this.agentId) {
      this.activeSessionId = event.status.sessionId ?? this.activeSessionId;
    }

    if (event.status.running && event.status.sessionId) {
      const targetChat = this.getTargetChat();
      if (targetChat && targetChat.agentId === this.agentId) {
        useAIChatStore.getState().setChatAcpSessionId(targetChat.id, event.status.sessionId);
      }
    }

    // Detect unexpected agent crash: was running but now stopped without user action
    if (this.wasRunning && !event.status.running && !this.sessionComplete && !this.cancelled) {
      console.warn("Agent crashed unexpectedly");
      this.fail("Agent disconnected unexpectedly. Click retry to restart.", true);
    }
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

      case "set_chat_title": {
        const targetChat = this.getTargetChat();
        const nextTitle = targetChat
          ? getChatTitleFromSessionInfo(targetChat.title, action.title)
          : null;
        if (targetChat && nextTitle) {
          useAIChatStore.getState().updateChatTitle(targetChat.id, nextTitle);
        }
        break;
      }
    }
  }

  private handleContentChunk(event: Extract<AcpEvent, { type: "content_chunk" }>): void {
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
    if (toolName && this.handlers.onToolComplete) {
      this.handlers.onToolComplete(toolName, event.toolId, event.output, event.error ?? undefined);
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

  private handleSessionComplete(): void {
    if (this.sessionComplete) return;
    console.log("Session complete");
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete();
  }

  private handleError(event: Extract<AcpEvent, { type: "error" }>): void {
    if (this.sessionComplete || this.cancelled) return;
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
      case "session_complete":
      case "error":
      case "plan_update":
      case "prompt_complete":
      case "ui_action":
        this.awaitingFirstResponse = false;
        if (this.firstResponseTimeout) {
          clearTimeout(this.firstResponseTimeout);
          this.firstResponseTimeout = null;
        }
        break;
    }
  }

  private armFirstResponseTimeout(): void {
    if (!this.awaitingFirstResponse || this.sessionComplete || this.cancelled) return;

    this.firstResponseTimeout = setTimeout(() => {
      this.fail(
        `${this.agentId} accepted the prompt but did not return any activity. Restart the agent session and try again.`,
      );
    }, ACP_FIRST_RESPONSE_TIMEOUT_MS);
  }

  private fail(error: string, canReconnect?: boolean): void {
    if (this.sessionComplete || this.cancelled) return;
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onError(error, canReconnect);
  }

  private cleanup(): void {
    console.log("Cleaning up ACP listeners...");
    this.awaitingFirstResponse = false;
    if (this.firstResponseTimeout) {
      clearTimeout(this.firstResponseTimeout);
      this.firstResponseTimeout = null;
    }
    this.pendingNewMessage = false;
    this.activeTools.clear();

    if (this.listeners.event) {
      this.listeners.event();
      this.listeners.event = undefined;
    }

    if (AcpStreamHandler.activeHandler === this) {
      AcpStreamHandler.activeHandler = null;
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
    optionId?: string,
  ): Promise<void> {
    await invoke("respond_acp_permission", {
      args: { requestId, approved, cancelled, optionId },
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

  static async listSessions(
    args: {
      cwd?: string;
      cursor?: string | null;
    } = {},
  ): Promise<AcpSessionList> {
    return invoke<AcpSessionList>("list_acp_sessions", {
      args: {
        cwd: args.cwd,
        cursor: args.cursor ?? undefined,
      },
    });
  }

  static async deleteSession(sessionId: string): Promise<void> {
    await invoke("delete_acp_session", {
      args: { sessionId },
    });
  }

  static async logoutAgent(): Promise<void> {
    await invoke("logout_acp_agent");
  }

  // Static method to stop the current agent
  static async stopAgent(): Promise<void> {
    await invoke("stop_acp_agent");
  }

  // Static method to cancel the current prompt turn
  static async cancelPrompt(): Promise<void> {
    AcpStreamHandler.activeHandler?.forceStop();
    try {
      await invoke("cancel_acp_prompt");
    } catch (error) {
      console.error("Failed to cancel ACP prompt on backend:", error);
    }
  }
}

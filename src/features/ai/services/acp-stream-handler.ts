import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/store/store";
import type {
  AcpAgentStatus,
  AcpEvent,
  AcpPromptContentBlock,
  AgentConfig,
} from "@/features/ai/types/acp";
import type { ContextInfo } from "@/features/ai/types/ai-context";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/features/window/stores/project-store";
import { getChatTitleFromSessionInfo } from "@/features/ai/lib/acp-session-info";
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

export class AcpStreamHandler {
  private static activeHandler: AcpStreamHandler | null = null;
  private listeners: AcpListeners = {};
  private timeout?: NodeJS.Timeout;
  private lastActivityTime = Date.now();
  private activeTools = new Map<string, string>();
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;
  private wasRunning = false;
  private receivedResponseSignal = false;

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
      this.receivedResponseSignal = false;
      await this.setupListeners();
      await this.ensureAgentRunning();
      await invoke("send_acp_prompt", { prompt: this.buildPrompt(userMessage, context) });
      this.setupTimeout();
    } catch (error) {
      console.error("ACP agent error:", error);
      this.cleanup();
      this.handlers.onError(this.formatStartupError(error));
    }
  }

  private async ensureAgentRunning(): Promise<void> {
    try {
      const status = await invoke<AcpAgentStatus>("get_acp_status");
      const targetChat = this.getTargetChat();
      const desiredSessionId =
        targetChat?.agentId === this.agentId ? (targetChat.acpSessionId ?? null) : null;
      const shouldRestartForSession =
        status.running &&
        status.agentId === this.agentId &&
        (status.sessionId ?? null) !== desiredSessionId;

      if (status.running) {
        useAIChatStore.getState().setAcpStatus(status);
      }

      if (!status.running || status.agentId !== this.agentId || shouldRestartForSession) {
        console.log(`Starting agent ${this.agentId}...`);

        // Get current workspace path if available
        const workspacePath = this.getWorkspacePath();

        let startStatus: AcpAgentStatus;
        try {
          startStatus = await invoke<AcpAgentStatus>("start_acp_agent", {
            agentId: this.agentId,
            workspacePath,
            sessionId: desiredSessionId,
          });
        } catch (error) {
          const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
          const agent = availableAgents.find((item) => item.id === this.agentId);
          if (!agent?.installed && agent?.canInstall) {
            await invoke<AgentConfig>("install_acp_agent", { agentId: this.agentId });
            startStatus = await invoke<AcpAgentStatus>("start_acp_agent", {
              agentId: this.agentId,
              workspacePath,
              sessionId: desiredSessionId,
            });
          } else {
            throw error;
          }
        }

        if (!startStatus.running) {
          throw new Error(`${this.agentId} failed to start`);
        }

        useAIChatStore.getState().setAcpStatus(startStatus);

        if (startStatus.sessionId) {
          if (targetChat) {
            useAIChatStore.getState().setChatAcpSessionId(targetChat.id, startStatus.sessionId);
          }
        }

        this.wasRunning = true;

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
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

    return `${this.agentId} is currently unavailable.`;
  }

  private buildPrompt(userMessage: string, context: ContextInfo): AcpPromptContentBlock[] {
    // ACP slash commands must remain the first token in the prompt.
    // If we prepend context, agents interpret them as plain text.
    if (userMessage.trimStart().startsWith("/")) {
      return [{ type: "text", text: userMessage }];
    }

    const contextPrompt = buildContextPrompt(context);
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
            uri: `file://${file.path}`,
            text: file.content,
            mimeType: "text/plain",
          },
        });
      } else {
        blocks.push({
          type: "resource_link",
          uri: `file://${file.path}`,
          name: file.path.split("/").pop() || file.path,
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
        uri: `file://${filePath}`,
        name: filePath.split("/").pop() || filePath,
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

    if (event.status.running && event.status.sessionId) {
      const targetChat = this.getTargetChat();
      if (targetChat && targetChat.agentId === this.agentId) {
        useAIChatStore.getState().setChatAcpSessionId(targetChat.id, event.status.sessionId);
      }
    }

    // Detect unexpected agent crash: was running but now stopped without user action
    if (this.wasRunning && !event.status.running && !this.sessionComplete && !this.cancelled) {
      console.warn("Agent crashed unexpectedly");
      this.cleanup();
      // Pass canReconnect=true to indicate the error is recoverable
      this.handlers.onError("Agent disconnected unexpectedly. Click retry to restart.", true);
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
    this.receivedResponseSignal = true;
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
    this.receivedResponseSignal = true;
    this.activeTools.set(event.toolId, event.toolName);
    if (this.handlers.onToolUse) {
      this.handlers.onToolUse(event);
    }
  }

  private handleToolUpdate(event: Extract<AcpEvent, { type: "tool_update" }>): void {
    this.receivedResponseSignal = true;
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
      console.warn("Tool call failed:", event.toolId);
    }
  }

  private handlePermissionRequest(event: Extract<AcpEvent, { type: "permission_request" }>): void {
    this.receivedResponseSignal = true;
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
    console.log("Session complete");
    this.sessionComplete = true;
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onComplete();
  }

  private handleError(event: Extract<AcpEvent, { type: "error" }>): void {
    console.error("ACP error:", event.error);
    this.pendingNewMessage = false;
    this.cleanup();
    this.handlers.onError(event.error);
  }

  private setupTimeout(): void {
    const checkInactivity = () => {
      const now = Date.now();
      const inactiveTime = now - this.lastActivityTime;

      // If session is already complete, don't check timeout
      if (this.sessionComplete) {
        return;
      }

      // If no activity for 10 seconds and no active tool, consider complete
      if (inactiveTime > 10000 && this.activeTools.size === 0) {
        if (!this.receivedResponseSignal) {
          console.log("No ACP response received before inactivity timeout");
          this.cleanup();
          this.handlers.onError(`${this.agentId} did not return any response.`, true);
          return;
        }
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

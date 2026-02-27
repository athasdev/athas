import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus, AcpEvent } from "@/features/ai/types/acp";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/stores/project-store";
import { buildContextPrompt } from "./context-builder";
import type { ContextInfo } from "./types";

interface AcpHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: unknown, toolId?: string) => void;
  onToolComplete?: (toolName: string, toolId?: string) => void;
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
  private static lastSessionIdByAgent = new Map<string, string>();
  private listeners: AcpListeners = {};
  private timeout?: NodeJS.Timeout;
  private lastActivityTime = Date.now();
  private activeTools = new Map<string, string>();
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;
  private wasRunning = false;

  constructor(
    private agentId: string,
    private handlers: AcpHandlers,
  ) {}

  async start(userMessage: string, context: ContextInfo): Promise<void> {
    try {
      AcpStreamHandler.activeHandler = this;
      await this.ensureAgentRunning();
      const fullMessage = this.buildMessage(userMessage, context);
      await this.setupListeners();
      await invoke("send_acp_prompt", { prompt: fullMessage });
      this.setupTimeout();
    } catch (error) {
      console.error("ACP agent error:", error);
      this.handlers.onError(`${this.agentId} is currently unavailable`);
    }
  }

  private async ensureAgentRunning(): Promise<void> {
    try {
      const status = await invoke<AcpAgentStatus>("get_acp_status");

      if (!status.running || status.agentId !== this.agentId) {
        console.log(`Starting agent ${this.agentId}...`);

        // Get current workspace path if available
        const workspacePath = this.getWorkspacePath();

        const startStatus = await invoke<AcpAgentStatus>("start_acp_agent", {
          agentId: this.agentId,
          workspacePath,
          sessionId: AcpStreamHandler.lastSessionIdByAgent.get(this.agentId) ?? null,
        });

        if (!startStatus.running) {
          throw new Error(`${this.agentId} failed to start`);
        }

        if (startStatus.sessionId) {
          AcpStreamHandler.lastSessionIdByAgent.set(this.agentId, startStatus.sessionId);
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

  private buildMessage(userMessage: string, context: ContextInfo): string {
    const contextPrompt = buildContextPrompt(context);
    return contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage;
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

      case "plan_update":
        // Plan updates are surfaced through generic ACP event stream UI for now
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

    if (event.status.running && event.status.sessionId) {
      AcpStreamHandler.lastSessionIdByAgent.set(this.agentId, event.status.sessionId);
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
      this.handlers.onToolUse(event.toolName, event.input, event.toolId);
    }
  }

  private handleToolComplete(event: Extract<AcpEvent, { type: "tool_complete" }>): void {
    const toolName = this.activeTools.get(event.toolId);
    if (toolName && this.handlers.onToolComplete) {
      this.handlers.onToolComplete(toolName, event.toolId);
    }
    this.activeTools.delete(event.toolId);
    this.pendingNewMessage = true;

    if (!event.success) {
      console.warn("Tool call failed:", event.toolId);
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
  ): Promise<void> {
    await invoke("respond_acp_permission", { args: { requestId, approved, cancelled } });
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

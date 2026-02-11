import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode, OutputStyle } from "@/features/ai/store/types";
import type { AcpAgentStatus, AcpEvent } from "@/features/ai/types/acp";
import { buildContextPrompt } from "./context-builder";
import {
  getValidKairoAccessToken,
  KAIRO_BASE_URL,
  KAIRO_CLIENT_NAME,
  KAIRO_CLIENT_PLATFORM,
  KAIRO_CLIENT_VERSION,
} from "./kairo-auth";
import type { ContextInfo } from "./types";

interface AcpHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onNewMessage?: () => void;
  onToolUse?: (
    toolName: string,
    toolInput?: unknown,
    toolId?: string,
    event?: Extract<AcpEvent, { type: "tool_start" }>,
  ) => void;
  onToolComplete?: (toolName: string, event?: Extract<AcpEvent, { type: "tool_complete" }>) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
}

interface AcpListeners {
  event?: () => void;
}

interface AcpStartOptions {
  mode?: ChatMode;
  outputStyle?: OutputStyle;
}

export class AcpStreamHandler {
  private static activeHandler: AcpStreamHandler | null = null;
  private listeners: AcpListeners = {};
  private timeout?: NodeJS.Timeout;
  private lastActivityTime = Date.now();
  private currentToolName: string | null = null;
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;

  constructor(
    private agentId: string,
    private handlers: AcpHandlers,
  ) {}

  async start(
    userMessage: string,
    context: ContextInfo,
    options: AcpStartOptions = {},
  ): Promise<void> {
    try {
      if (AcpStreamHandler.activeHandler && AcpStreamHandler.activeHandler !== this) {
        AcpStreamHandler.activeHandler.cancelled = true;
        AcpStreamHandler.activeHandler.cleanup();
      }
      AcpStreamHandler.activeHandler = this;
      await this.ensureAgentRunning(context);
      const fullMessage = this.buildMessage(userMessage, context, options);
      await this.setupListeners();
      await invoke("send_acp_prompt", { prompt: fullMessage });
      this.setupTimeout();
    } catch (error) {
      console.error("ACP agent error:", error);
      this.handlers.onError(`${this.agentId} is currently unavailable`);
    }
  }

  private async ensureAgentRunning(context: ContextInfo): Promise<void> {
    try {
      const status = await invoke<AcpAgentStatus>("get_acp_status");

      if (!status.running || status.agentId !== this.agentId) {
        console.log(`Starting agent ${this.agentId}...`);

        const workspacePath = this.getWorkspacePath(context);
        const envVars = await this.getAgentEnvVars();

        const startStatus = await invoke<AcpAgentStatus>("start_acp_agent", {
          agentId: this.agentId,
          workspacePath,
          envVars,
        });

        if (!startStatus.running) {
          throw new Error(`${this.agentId} failed to start`);
        }

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      throw new Error(`${this.agentId} is currently unavailable: ${error}`);
    }
  }

  private getWorkspacePath(context: ContextInfo): string | null {
    const root =
      typeof context.projectRoot === "string" && context.projectRoot.trim().length > 0
        ? context.projectRoot.trim()
        : null;
    return root;
  }

  private async getAgentEnvVars(): Promise<Record<string, string> | undefined> {
    if (this.agentId !== "kairo-code") {
      return undefined;
    }

    const accessToken = await getValidKairoAccessToken();
    if (!accessToken) {
      throw new Error(
        "Kairo Code is not connected. Login in Settings > AI > Agent Authentication.",
      );
    }

    // Kairo ACP in Athas is expected to run with tool-calling enabled.
    // Keep this hard-coded for now to avoid accidental silent downgrade.
    const enableKairoTools = true;

    console.info(`[delete-me][kairo-acp-debug] env_tools_enabled=${enableKairoTools ? "1" : "0"}`);

    return {
      KAIRO_ACCESS_TOKEN: accessToken,
      COLINE_KAIRO_ACCESS_TOKEN: accessToken,
      KAIRO_OAUTH_ACCESS_TOKEN: accessToken,
      KAIRO_BASE_URL,
      KAIRO_CLIENT_NAME,
      KAIRO_CLIENT_VERSION,
      KAIRO_CLIENT_PLATFORM,
      KAIRO_ENABLE_TOOLS: enableKairoTools ? "1" : "0",
    };
  }

  private buildMessage(
    userMessage: string,
    context: ContextInfo,
    options: AcpStartOptions,
  ): string {
    const contextPrompt = buildContextPrompt(context);
    const mode = options.mode ?? "chat";

    if (this.agentId === "kairo-code" && mode === "plan") {
      const planDirective = `PLAN MODE: You are in planning mode.
- Do not execute or modify code directly.
- Focus on analysis, step-by-step implementation planning, and risks.
- Use conditional wording (would/could/should), not direct execution wording.

When returning an implementation plan, use this exact structure:

[PLAN_BLOCK]
[STEP] Short step title
Detailed step description with specific files/commands.
[/STEP]
[/PLAN_BLOCK]`;

      if (!contextPrompt) {
        return `${planDirective}\n\nUser request:\n${userMessage}`;
      }

      return `${planDirective}\n\nContext:\n${contextPrompt}\n\nUser request:\n${userMessage}`;
    }

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
      case "content_chunk":
        this.handleContentChunk(event);
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
        // Status changes are informational
        console.log("Agent status changed:", event.status);
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

      case "prompt_complete":
        this.handlePromptComplete(event);
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

  private handleContentChunk(event: Extract<AcpEvent, { type: "content_chunk" }>): void {
    if (event.content.type === "text") {
      if (this.pendingNewMessage && this.handlers.onNewMessage) {
        this.handlers.onNewMessage();
      }
      this.pendingNewMessage = false;

      this.handlers.onChunk(event.content.text);
    }

    if (event.isComplete) {
      // Content block is complete, but session may continue
      console.log("Content block complete");
    }
  }

  private handleToolStart(event: Extract<AcpEvent, { type: "tool_start" }>): void {
    this.currentToolName = event.toolName;
    if (this.handlers.onToolUse) {
      this.handlers.onToolUse(event.toolName, event.input, event.toolId, event);
    }
  }

  private handleToolComplete(event: Extract<AcpEvent, { type: "tool_complete" }>): void {
    if (this.handlers.onToolComplete) {
      this.handlers.onToolComplete(event.toolName || this.currentToolName || "unknown", event);
    }
    this.currentToolName = null;
    this.pendingNewMessage = true;

    if (!event.success) {
      console.warn("Tool call failed:", event.toolId);
    }
  }

  private handlePermissionRequest(event: Extract<AcpEvent, { type: "permission_request" }>): void {
    if (this.handlers.onPermissionRequest) {
      this.handlers.onPermissionRequest(event);
    } else {
      // Auto-approve if no handler (for now)
      // In production, this should show a dialog
      console.warn("Permission request received but no handler set, auto-approving");
      AcpStreamHandler.respondToPermission(event.requestId, true).catch(console.error);
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
      if (inactiveTime > 10000 && !this.currentToolName) {
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
    await invoke("cancel_acp_prompt");
    AcpStreamHandler.activeHandler?.forceStop();
  }
}

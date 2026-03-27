import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getChatPreferredAcpModeId } from "@/features/ai/lib/chat-acp-state";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AcpAgentStatus, AcpEvent } from "@/features/ai/types/acp";
import type { AIChatSurface, ChatScopeId } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useProjectStore } from "@/stores/project-store";
import { buildContextPrompt } from "./context-builder";
import type { ContextInfo } from "./types";

interface PiNativeHandlers {
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
  resumeKey?: string;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: unknown, toolId?: string) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onEvent?: (event: AcpEvent) => void;
  onImageChunk?: (data: string, mediaType: string) => void;
  onResourceChunk?: (uri: string, name: string | null) => void;
}

interface PiNativeListeners {
  event?: () => void;
}

interface PiNativeBootstrapContext {
  conversationHistory: AIMessage[];
}

export class PiNativeStreamHandler {
  private static activeHandlers = new Map<ChatScopeId, PiNativeStreamHandler>();
  private static lastSessionPathByKey = new Map<string, string>();
  private static readonly TERMINAL_SETTLE_DELAY_MS = 100;
  private listeners: PiNativeListeners = {};
  private timeout?: NodeJS.Timeout;
  private terminalSettleTimeout?: NodeJS.Timeout;
  private lastActivityTime = Date.now();
  private hasObservedResponseActivity = false;
  private activeTools = new Map<string, string>();
  private sessionComplete = false;
  private pendingNewMessage = false;
  private cancelled = false;
  private sessionId: string | null = null;
  private readonly scopeId: ChatScopeId;
  private readonly resumeKey: string;

  constructor(private handlers: PiNativeHandlers) {
    this.scopeId = handlers.scopeId ?? "panel";
    this.resumeKey = handlers.resumeKey ?? this.scopeId;
  }

  async start(
    userMessage: string,
    context: ContextInfo,
    conversationHistory?: AIMessage[],
  ): Promise<void> {
    try {
      PiNativeStreamHandler.activeHandlers.set(this.scopeId, this);
      await this.setupListeners();
      await this.ensureSessionRunning(conversationHistory);
      const fullMessage = this.buildMessage(userMessage, context);
      await invoke("send_pi_native_prompt", { prompt: fullMessage, routeKey: this.resumeKey });
      this.setupTimeout();
    } catch (error) {
      console.error("Pi native error:", error);
      this.cleanup();
      this.handlers.onError(error instanceof Error ? error.message : "Pi native is unavailable");
    }
  }

  private async ensureSessionRunning(conversationHistory?: AIMessage[]): Promise<void> {
    const status = await invoke<AcpAgentStatus>("get_pi_native_status", {
      routeKey: this.resumeKey,
    });
    if (status.running && status.sessionId) {
      this.sessionId = status.sessionId;
      return;
    }

    const sessionPath = this.getDesiredSessionPath();
    const bootstrap: PiNativeBootstrapContext | null =
      !sessionPath && conversationHistory && conversationHistory.length > 0
        ? { conversationHistory }
        : null;
    const startStatus = await invoke<AcpAgentStatus>("start_pi_native_session", {
      workspacePath: this.getWorkspacePath(),
      sessionPath,
      bootstrap,
      routeKey: this.resumeKey,
    });

    if (!startStatus.initialized) {
      throw new Error("Pi native session failed to initialize");
    }

    this.sessionId = startStatus.sessionId ?? null;
  }

  private getDesiredSessionPath(): string | null {
    const currentChat = useAIChatStore.getState().getCurrentChat(this.scopeId);
    const runtimePath = currentChat?.acpState?.runtimeState?.sessionPath;
    if (runtimePath) {
      PiNativeStreamHandler.lastSessionPathByKey.set(this.resumeKey, runtimePath);
      return runtimePath;
    }

    return PiNativeStreamHandler.lastSessionPathByKey.get(this.resumeKey) ?? null;
  }

  private getWorkspacePath(): string | null {
    return useProjectStore.getState().rootFolderPath ?? null;
  }

  private buildMessage(userMessage: string, context: ContextInfo): string {
    const contextPrompt = buildContextPrompt(context);
    return [contextPrompt, userMessage].filter(Boolean).join("\n\n");
  }

  private async setupListeners(): Promise<void> {
    this.listeners.event = await listen<AcpEvent>("acp-event", (event) => {
      this.handleEvent(event.payload);
    });
  }

  private handleEvent(event: AcpEvent): void {
    if (this.cancelled || event.routeKey !== this.resumeKey) {
      return;
    }

    if (this.handlers.onEvent) {
      this.handlers.onEvent(event);
    }

    this.lastActivityTime = Date.now();

    switch (event.type) {
      case "content_chunk":
        this.hasObservedResponseActivity = true;
        if (this.pendingNewMessage && this.handlers.onNewMessage) {
          this.handlers.onNewMessage();
        }
        this.pendingNewMessage = false;

        if (event.content.type === "text") {
          this.handlers.onChunk(event.content.text);
        } else if (event.content.type === "image" && this.handlers.onImageChunk) {
          this.handlers.onImageChunk(event.content.data, event.content.mediaType);
        } else if (event.content.type === "resource" && this.handlers.onResourceChunk) {
          this.handlers.onResourceChunk(event.content.uri, event.content.name);
        }
        break;

      case "thought_chunk":
        this.hasObservedResponseActivity = true;
        break;

      case "tool_start":
        this.hasObservedResponseActivity = true;
        this.activeTools.set(event.toolId, event.toolName);
        this.handlers.onToolUse?.(event.toolName, event.input, event.toolId);
        break;

      case "tool_complete": {
        this.hasObservedResponseActivity = true;
        const toolName = this.activeTools.get(event.toolId);
        if (toolName) {
          const error =
            event.success === false
              ? typeof event.output === "string"
                ? event.output
                : "Tool failed"
              : undefined;
          this.handlers.onToolComplete?.(toolName, event.toolId, event.output, error);
        }
        this.activeTools.delete(event.toolId);
        this.pendingNewMessage = true;
        break;
      }

      case "runtime_state_update":
        if (event.runtimeState.sessionId) {
          this.sessionId = event.runtimeState.sessionId;
        }
        if (event.runtimeState.sessionPath) {
          PiNativeStreamHandler.lastSessionPathByKey.set(
            this.resumeKey,
            event.runtimeState.sessionPath,
          );
        }
        useAIChatStore.getState().setAcpRuntimeState(event.runtimeState, this.scopeId);
        break;

      case "status_changed":
        if (!event.status.running) {
          useAIChatStore.getState().markPendingAcpPermissionsStale(this.scopeId);
          useAIChatStore.getState().hydrateAcpStateFromCurrentChat(this.scopeId);
        }
        break;

      case "prompt_complete":
        if (event.stopReason === "cancelled") {
          this.cleanup();
          this.handlers.onComplete();
          return;
        }

        if (event.stopReason === "max_tokens") {
          this.cleanup();
          this.handlers.onError("Pi native context window exceeded");
          return;
        }

        this.scheduleTerminalCompletion();
        break;

      case "session_complete":
        this.sessionComplete = true;
        this.pendingNewMessage = false;
        this.cleanup();
        this.handlers.onComplete();
        break;

      case "error":
        this.scheduleTerminalError(event.error);
        break;

      case "ui_action": {
        const bufferActions = useBufferStore.getState().actions;
        if (event.action.action === "open_web_viewer") {
          bufferActions.openWebViewerBuffer(event.action.url);
        } else if (event.action.action === "open_terminal") {
          bufferActions.openTerminalBuffer({
            command: event.action.command ?? undefined,
            name: event.action.command ?? undefined,
          });
        }
        break;
      }

      default:
        break;
    }
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
      this.sessionComplete = true;
      this.cleanup();
      this.handlers.onComplete();
    }, PiNativeStreamHandler.TERMINAL_SETTLE_DELAY_MS);
  }

  private scheduleTerminalError(error: string): void {
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
      this.cleanup();
      this.handlers.onError(error);
    }, PiNativeStreamHandler.TERMINAL_SETTLE_DELAY_MS);
  }

  private setupTimeout(): void {
    const checkInactivity = () => {
      if (this.sessionComplete) {
        return;
      }

      const inactiveTime = Date.now() - this.lastActivityTime;
      if (this.hasObservedResponseActivity && inactiveTime > 10000 && this.activeTools.size === 0) {
        this.cleanup();
        this.handlers.onComplete();
        return;
      }

      if (inactiveTime > 60000) {
        this.cleanup();
        this.handlers.onError("Request timed out - no activity");
        return;
      }

      this.timeout = setTimeout(checkInactivity, 1000);
    };

    this.timeout = setTimeout(checkInactivity, 1000);
  }

  private cleanup(): void {
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

    if (PiNativeStreamHandler.activeHandlers.get(this.scopeId) === this) {
      PiNativeStreamHandler.activeHandlers.delete(this.scopeId);
    }
  }

  private forceStop(): void {
    if (this.sessionComplete || this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.cleanup();
    this.handlers.onComplete();
  }

  static async getStatus(scopeId: ChatScopeId = "panel"): Promise<AcpAgentStatus> {
    return invoke("get_pi_native_status", { routeKey: scopeId });
  }

  static async listSessions(workspacePath: string | null): Promise<PiNativeSessionInfo[]> {
    return invoke("list_pi_native_sessions", { workspacePath });
  }

  static async stopSession(scopeId: ChatScopeId = "panel"): Promise<void> {
    PiNativeStreamHandler.activeHandlers.get(scopeId)?.forceStop();
    PiNativeStreamHandler.lastSessionPathByKey.delete(scopeId);
    await invoke("stop_pi_native_session", { routeKey: scopeId });
  }

  static async cancelPrompt(scopeId: ChatScopeId = "panel"): Promise<void> {
    PiNativeStreamHandler.activeHandlers.get(scopeId)?.forceStop();
    try {
      await invoke("cancel_pi_native_prompt", { routeKey: scopeId });
    } catch (error) {
      console.error("Failed to cancel native Pi prompt on backend:", error);
    }
  }

  static getPreferredModeId(scopeId: ChatScopeId): string | null {
    const currentChat = useAIChatStore.getState().getCurrentChat(scopeId);
    const defaultModeId = null;
    return getChatPreferredAcpModeId(currentChat, defaultModeId);
  }
}

export interface PiNativeSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name: string | null;
  parentSessionPath: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  firstMessage: string;
}

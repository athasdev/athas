import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeStatus, InterceptorMessage } from "@/types/claude";
import { buildContextPrompt } from "./context-builder";
import type { ContextInfo } from "./types";

interface ClaudeCodeHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: any) => void;
  onToolComplete?: (toolName: string) => void;
}

interface ClaudeListeners {
  interceptor?: () => void;
}

export class ClaudeCodeStreamHandler {
  private currentStopReason: string | null = null;
  private listeners: ClaudeListeners = {};
  private timeout?: NodeJS.Timeout;
  private expectingMoreMessages = false;
  private lastActivityTime = Date.now();
  private messageCount = 0;
  private isFirstMessage = true;
  private currentToolName: string | null = null;

  constructor(private handlers: ClaudeCodeHandlers) {}

  async start(userMessage: string, context: ContextInfo): Promise<void> {
    try {
      await this.ensureClaudeCodeRunning();
      const fullMessage = this.buildMessage(userMessage, context);
      await this.setupListeners();
      await invoke("send_claude_input", { input: fullMessage });
      this.setupTimeout();
    } catch (error) {
      console.error("❌ Claude Code error:", error);
      this.handlers.onError(`Claude Code error: ${error}`);
    }
  }

  private async ensureClaudeCodeRunning(): Promise<void> {
    const status = await invoke<ClaudeStatus>("get_claude_status");

    if (!status.running) {
      console.log("🚀 Starting Claude Code...");
      const startStatus = await invoke<ClaudeStatus>("start_claude_code");

      if (!startStatus.running) {
        throw new Error("Failed to start Claude Code. Please check your setup.");
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private buildMessage(userMessage: string, context: ContextInfo): string {
    const contextPrompt = buildContextPrompt(context);
    return contextPrompt ? `${contextPrompt}\n\n${userMessage}` : userMessage;
  }

  private async setupListeners(): Promise<void> {
    this.listeners.interceptor = await listen<InterceptorMessage>("claude-message", event => {
      this.handleInterceptorMessage(event.payload);
    });
  }

  private handleInterceptorMessage(message: InterceptorMessage): void {
    console.log(
      "📡 Interceptor message type:",
      message.type,
      "request_id:",
      message.request_id || message.data?.id,
    );

    switch (message.type) {
      case "stream_chunk":
        this.handleStreamChunk(message.chunk);
        break;
      case "response":
        this.handleResponse(message.data?.parsed_response);
        break;
      case "error":
        console.log("❌ Error from interceptor, cleaning up...");
        this.cleanup();
        this.handlers.onError(message.error || "Unknown error from interceptor");
        break;
    }
  }

  private handleStreamChunk(chunk: any): void {
    if (!chunk) return;

    this.lastActivityTime = Date.now();

    if (chunk.type === "message_start" && chunk.message) {
      this.currentStopReason = chunk.message.stop_reason || null;
      console.log("📋 message_start with stop_reason:", this.currentStopReason);

      // If this is not the first message, signal a new message
      if (!this.isFirstMessage && this.handlers.onNewMessage) {
        console.log("📝 Starting new message in conversation");
        this.handlers.onNewMessage();
      }
      this.isFirstMessage = false;
      this.messageCount++;
    }

    // Handle tool use blocks
    if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
      this.currentToolName = chunk.content_block.name || "unknown";
      if (this.handlers.onToolUse) {
        this.handlers.onToolUse(this.currentToolName!, chunk.content_block.input);
      }
    }

    // Handle tool completion
    if (chunk.type === "content_block_stop") {
      if (this.currentToolName && this.handlers.onToolComplete) {
        this.handlers.onToolComplete(this.currentToolName!);
      }
      this.currentToolName = null;
    }

    if (chunk.delta?.text) {
      this.handlers.onChunk(chunk.delta.text);
    }

    if (chunk.type === "message_stop") {
      console.log("🛑 message_stop in stream_chunk, stop_reason was:", this.currentStopReason);

      if (this.currentStopReason === "tool_use") {
        console.log("🔧 Tool use detected, expecting more messages...");
        this.expectingMoreMessages = true;
        this.currentStopReason = null;
      } else if (this.expectingMoreMessages) {
        console.log("📝 Follow-up message complete after tool use");
        this.expectingMoreMessages = false;
        // Don't cleanup yet - there might be more messages
      } else {
        console.log(
          "⏳ Message complete, but not cleaning up yet - waiting for explicit completion signal",
        );
        // Don't cleanup on message_stop anymore
      }
      this.currentStopReason = null;
    }
  }

  private handleResponse(response: any): void {
    if (!response) return;

    this.lastActivityTime = Date.now();

    console.log("📨 Response data:", {
      stop_reason: response.stop_reason,
      usage: response.usage,
      content_blocks: response.content?.length,
    });

    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          this.handlers.onChunk(block.text);
        }
      }
    }

    if (response.stop_reason === "tool_use") {
      console.log("🔧 Tool use detected in response, expecting more messages...");
      this.expectingMoreMessages = true;
    } else {
      console.log("📨 Response received, but not cleaning up - waiting for activity timeout");
      // Don't cleanup immediately - wait for inactivity timeout
    }
  }

  private setupTimeout(): void {
    // Check for inactivity every second
    const checkInactivity = () => {
      const now = Date.now();
      const inactiveTime = now - this.lastActivityTime;

      // If no activity for 5 seconds and not expecting more messages, complete
      if (inactiveTime > 5000 && !this.expectingMoreMessages) {
        console.log("✅ No activity for 5 seconds, conversation appears complete");
        this.cleanup();
        this.handlers.onComplete();
        return;
      }

      // If still expecting messages but no activity for 30 seconds, timeout
      if (inactiveTime > 30000) {
        console.log("⏰ Timeout: No activity for 30 seconds");
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
    console.log("Cleaning up Claude Code listeners...");

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    Object.values(this.listeners).forEach(unlisten => {
      if (unlisten) unlisten();
    });

    this.listeners = {};
  }
}

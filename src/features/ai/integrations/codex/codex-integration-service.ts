import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { runCodexDynamicTool } from "./codex-dynamic-tools";
import type {
  CodexIntegrationStatus,
  CodexProtocolEvent,
  CodexThreadSettings,
} from "./codex-types";

interface CodexHandlers {
  onChunk: (chunk: string) => void;
  onComplete: (result?: AgentCompletionResult) => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onResponseContinuation?: () => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
}

export const codexSettingsKey = "athas-codex-integration-settings";
export const codexSettingsChanged = "athas-codex-settings-changed";
export const defaultCodexSettings: CodexThreadSettings = {
  effort: "medium",
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
  collaborationMode: "default",
};

export function getCodexSettings(): CodexThreadSettings {
  try {
    return {
      ...defaultCodexSettings,
      ...JSON.parse(localStorage.getItem(codexSettingsKey) ?? "{}"),
    };
  } catch {
    return defaultCodexSettings;
  }
}

export function saveCodexSettings(settings: CodexThreadSettings) {
  localStorage.setItem(codexSettingsKey, JSON.stringify(settings));
  window.dispatchEvent(new Event(codexSettingsChanged));
}

function itemId(params: Record<string, any>) {
  return String(params.item?.id ?? params.itemId ?? crypto.randomUUID());
}

function itemName(params: Record<string, any>) {
  const item = params.item ?? {};
  return String(item.command ?? item.tool ?? item.name ?? item.type ?? "Codex tool");
}

const CODEX_TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageView",
  "sleep",
  "imageGeneration",
]);

function isCodexToolItem(params: Record<string, any>) {
  return CODEX_TOOL_ITEM_TYPES.has(String(params.item?.type ?? ""));
}

export class CodexIntegrationService {
  private static active: CodexIntegrationService | null = null;
  private unlisten: UnlistenFn | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private projectRoot = ".";
  private pendingNewMessage = false;

  constructor(
    private handlers: CodexHandlers,
    private chatId?: string,
  ) {}

  async start(message: string, context: ContextInfo) {
    if (CodexIntegrationService.active && CodexIntegrationService.active !== this) {
      this.handlers.onError("Another Codex session is already running. Stop it before retrying.");
      return;
    }
    CodexIntegrationService.active = this;
    const cwd = context.projectRoot?.trim() || ".";
    this.projectRoot = cwd;
    try {
      const chat = this.chatId
        ? useAIChatStore.getState().actions.getChatById(this.chatId)
        : undefined;
      const result = await invoke<any>("start_codex_thread", {
        args: { cwd, threadId: chat?.acpSessionId ?? null, settings: getCodexSettings() },
      });
      this.threadId = result.thread.id;
      if (this.chatId) {
        useAIChatStore.getState().actions.setChatAcpSessionId(this.chatId, this.threadId);
      }
      this.unlisten = await listen<CodexProtocolEvent>("codex-event", ({ payload }) =>
        this.handleEvent(payload),
      );
      const turn = await invoke<any>("start_codex_turn", {
        args: {
          threadId: this.threadId,
          input: [{ type: "text", text: message, text_elements: [] }],
          settings: getCodexSettings(),
        },
      });
      this.turnId = turn.turn?.id ?? null;
    } catch (error) {
      this.dispose();
      this.handlers.onError(String(error), true);
    }
  }

  private handleEvent(event: CodexProtocolEvent) {
    const { method, params } = event;
    if (method === "thread/name/updated") {
      const eventThreadId = String(params.threadId ?? "");
      const threadName = typeof params.threadName === "string" ? params.threadName.trim() : "";
      if (this.chatId && eventThreadId === this.threadId && threadName) {
        useAIChatStore.getState().actions.updateChatTitle(this.chatId, threadName);
      }
      return;
    }

    if (!this.isEventForCurrentRun(params)) return;

    if (method === "turn/started") {
      this.turnId = String(params.turn?.id ?? params.turnId ?? "") || this.turnId;
      return;
    }

    if (method === "item/tool/call" && event.id != null) {
      const toolName = String(params.tool ?? "");
      const result = runCodexDynamicTool(toolName, params.arguments, {
        projectRoot: this.projectRoot,
        openPullRequest: useBufferStore.getState().actions.openPRBuffer,
        openIssue: useBufferStore.getState().actions.openGitHubIssueBuffer,
        setChatTitle: (title) => {
          if (!this.chatId) return false;
          const actions = useAIChatStore.getState().actions;
          if (!actions.getChatById(this.chatId)) return false;
          actions.updateChatTitle(this.chatId, title);
          return true;
        },
      }) ?? {
        contentItems: [{ type: "inputText" as const, text: `Unknown Athas tool: ${toolName}` }],
        success: false,
      };
      void invoke("respond_codex_request", {
        response: { requestId: event.id, decision: result },
      }).catch((error) => this.handlers.onError(String(error), true));
      return;
    }

    if (method === "item/agentMessage/delta") {
      this.startPendingMessage();
      this.handlers.onChunk(String(params.delta ?? ""));
      return;
    }
    if (method === "item/started") {
      const type = String(params.item?.type ?? "");
      if (type === "reasoning") {
        this.startPendingMessage();
        this.handlers.onEvent?.({
          type: "thought_chunk",
          sessionId: this.threadId ?? "codex",
          content: { type: "text", text: "" },
          isComplete: false,
        });
      } else if (isCodexToolItem(params)) {
        const toolEvent: Extract<AcpEvent, { type: "tool_start" }> = {
          type: "tool_start",
          sessionId: this.threadId ?? "codex",
          toolName: itemName(params),
          toolId: itemId(params),
          input: params.item,
          kind: type === "fileChange" ? "edit" : type === "commandExecution" ? "execute" : "other",
          status: "in_progress",
          locations: [],
        };
        this.handlers.onToolUse?.(toolEvent);
        this.handlers.onEvent?.(toolEvent);
      }
      return;
    }
    if (method === "item/completed") {
      if (isCodexToolItem(params)) {
        this.handlers.onToolComplete?.(
          itemName(params),
          itemId(params),
          params.item,
          params.item?.error?.message,
        );
        this.pendingNewMessage = true;
      }
      return;
    }
    if (method.endsWith("/requestApproval") && event.id != null) {
      const permission: Extract<AcpEvent, { type: "permission_request" }> = {
        type: "permission_request",
        sessionId: this.threadId ?? "codex",
        requestId: String(event.id),
        permissionType: method.includes("fileChange") ? "file-change" : "command",
        resource: String(params.command ?? params.filePath ?? "Workspace"),
        description: String(params.reason ?? "Codex needs approval to continue"),
        options: [
          { id: "accept", name: "Allow", kind: "allow_once" },
          { id: "decline", name: "Deny", kind: "reject_once" },
        ],
      };
      this.handlers.onPermissionRequest?.(permission);
      return;
    }
    if (method === "turn/completed") {
      const failed = params.turn?.status === "failed";
      const cancelled = ["canceled", "cancelled"].includes(String(params.turn?.status));
      this.pendingNewMessage = false;
      this.dispose();
      if (failed) {
        this.handlers.onError(params.turn?.error?.message ?? "Codex turn failed");
      } else {
        this.handlers.onComplete({ outcome: cancelled ? "cancelled" : "completed" });
      }
    }
    if (method === "error") {
      this.dispose();
      this.handlers.onError(String(params.message ?? "Codex app-server error"), true);
    }
  }

  private isEventForCurrentRun(params: Record<string, any>) {
    if (!this.threadId || String(params.threadId ?? "") !== this.threadId) return false;

    const eventTurnId = String(params.turnId ?? params.turn?.id ?? "");
    return !this.turnId || !eventTurnId || eventTurnId === this.turnId;
  }

  private startPendingMessage() {
    if (!this.pendingNewMessage) return;
    this.pendingNewMessage = false;
    this.handlers.onResponseContinuation?.();
  }

  private dispose() {
    this.pendingNewMessage = false;
    this.unlisten?.();
    this.unlisten = null;
    if (CodexIntegrationService.active === this) CodexIntegrationService.active = null;
  }

  static async cancel() {
    const current = CodexIntegrationService.active;
    if (!current?.threadId || !current.turnId) return;
    await invoke("interrupt_codex_turn", { threadId: current.threadId, turnId: current.turnId });
    current.dispose();
  }

  static async respond(requestId: string, approved: boolean) {
    await invoke("respond_codex_request", {
      response: {
        requestId: Number(requestId),
        decision: { decision: approved ? "accept" : "decline" },
      },
    });
  }

  static status() {
    return invoke<CodexIntegrationStatus>("get_codex_status");
  }
}

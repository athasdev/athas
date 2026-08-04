import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { runCodexDynamicTool } from "./codex-dynamic-tools";
import type {
  CodexIntegrationStatus,
  CodexProtocolEvent,
  CodexThreadSettings,
} from "./codex-types";

interface CodexHandlers {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
}

const settingsKey = "athas-codex-integration-settings";
export const defaultCodexSettings: CodexThreadSettings = {
  effort: "medium",
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
  collaborationMode: "default",
};

export function getCodexSettings(): CodexThreadSettings {
  try {
    return { ...defaultCodexSettings, ...JSON.parse(localStorage.getItem(settingsKey) ?? "{}") };
  } catch {
    return defaultCodexSettings;
  }
}

export function saveCodexSettings(settings: CodexThreadSettings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function itemId(params: Record<string, any>) {
  return String(params.item?.id ?? params.itemId ?? crypto.randomUUID());
}

function itemName(params: Record<string, any>) {
  const item = params.item ?? {};
  return String(item.command ?? item.name ?? item.type ?? "Codex tool");
}

export class CodexIntegrationService {
  private static active: CodexIntegrationService | null = null;
  private unlisten: UnlistenFn | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private projectRoot = ".";

  constructor(
    private handlers: CodexHandlers,
    private chatId?: string,
  ) {}

  async start(message: string, context: ContextInfo) {
    CodexIntegrationService.active = this;
    const cwd = context.projectRoot?.trim() || ".";
    this.projectRoot = cwd;
    this.unlisten = await listen<CodexProtocolEvent>("codex-event", ({ payload }) =>
      this.handleEvent(payload),
    );
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
      this.handlers.onChunk(String(params.delta ?? ""));
      return;
    }
    if (method === "item/started") {
      const type = String(params.item?.type ?? "");
      if (type !== "agentMessage" && type !== "reasoning") {
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
      const type = String(params.item?.type ?? "");
      if (type !== "agentMessage" && type !== "reasoning") {
        this.handlers.onToolComplete?.(
          itemName(params),
          itemId(params),
          params.item,
          params.item?.error?.message,
        );
      }
      return;
    }
    if (method.endsWith("/requestApproval") && event.id != null) {
      const permission: Extract<AcpEvent, { type: "permission_request" }> = {
        type: "permission_request",
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
      this.dispose();
      if (failed) {
        this.handlers.onError(params.turn?.error?.message ?? "Codex turn failed");
      } else {
        this.handlers.onComplete();
      }
    }
    if (method === "error") {
      this.handlers.onError(String(params.message ?? "Codex app-server error"), true);
    }
  }

  private dispose() {
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

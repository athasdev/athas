// Types for Agent Client Protocol (ACP) integration

export interface AgentConfig {
  id: string;
  name: string;
  binaryName: string;
  binaryPath: string | null;
  args: string[];
  envVars: Record<string, string>;
  icon: string | null;
  description: string | null;
  installed: boolean;
}

export interface AcpAgentStatus {
  agentId: string;
  running: boolean;
  sessionActive: boolean;
  initialized: boolean;
}

export type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string }
  | { type: "resource"; uri: string; name: string | null };

// Slash command types
export interface SlashCommandInput {
  hint: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  input?: SlashCommandInput;
}

// Session mode types
export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string | null;
  availableModes: SessionMode[];
}

// Prompt turn types
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

// UI action types that agents can request
export type UiAction =
  | { action: "open_web_viewer"; url: string }
  | { action: "open_terminal"; command: string | null };

export type AcpEvent =
  | {
      type: "content_chunk";
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "tool_start";
      sessionId: string;
      toolName: string;
      toolId: string;
      input: unknown;
      status?: AcpToolStatus;
      kind?: string;
      content?: unknown;
      locations?: unknown;
    }
  | {
      type: "tool_complete";
      sessionId: string;
      toolId: string;
      success: boolean;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      error?: string;
      status?: AcpToolStatus;
      kind?: string;
      content?: unknown;
      locations?: unknown;
    }
  | {
      type: "permission_request";
      requestId: string;
      permissionType: string;
      resource: string;
      description: string;
    }
  | {
      type: "session_complete";
      sessionId: string;
    }
  | {
      type: "error";
      sessionId: string | null;
      error: string;
    }
  | {
      type: "status_changed";
      status: AcpAgentStatus;
    }
  | {
      type: "slash_commands_update";
      sessionId: string;
      commands: SlashCommand[];
    }
  | {
      type: "session_mode_update";
      sessionId: string;
      modeState: SessionModeState;
    }
  | {
      type: "current_mode_update";
      sessionId: string;
      currentModeId: string;
    }
  | {
      type: "prompt_complete";
      sessionId: string;
      stopReason: StopReason;
    }
  | {
      type: "ui_action";
      sessionId: string;
      action: UiAction;
    };

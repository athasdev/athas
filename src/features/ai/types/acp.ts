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
  sessionId?: string | null;
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

export interface AcpRuntimeState {
  agentId: string;
  source?: string | null;
  sessionId: string | null;
  sessionPath: string | null;
  workspacePath: string | null;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  behavior: string | null;
}

export interface AcpToolLocation {
  path: string;
  line?: number | null;
}

export type AcpPlanEntryPriority = "high" | "medium" | "low";
export type AcpPlanEntryStatus = "pending" | "in_progress" | "completed";

export interface AcpPlanEntry {
  content: string;
  priority: AcpPlanEntryPriority;
  status: AcpPlanEntryStatus;
}

// Prompt turn types
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

// UI action types that agents can request
export type UiAction =
  | { action: "open_web_viewer"; url: string }
  | { action: "open_terminal"; command: string | null };

export type AcpEvent =
  | {
      type: "user_message_chunk";
      routeKey: string;
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "content_chunk";
      routeKey: string;
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "thought_chunk";
      routeKey: string;
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "tool_start";
      routeKey: string;
      sessionId: string;
      toolName: string;
      toolId: string;
      input: unknown;
    }
  | {
      type: "tool_complete";
      routeKey: string;
      sessionId: string;
      toolId: string;
      success: boolean;
      output?: unknown;
      locations?: AcpToolLocation[] | null;
    }
  | {
      type: "permission_request";
      routeKey: string;
      requestId: string;
      permissionType: string;
      resource: string;
      description: string;
      title?: string | null;
      placeholder?: string | null;
      defaultValue?: string | null;
      options?: string[] | null;
    }
  | {
      type: "session_complete";
      routeKey: string;
      sessionId: string;
    }
  | {
      type: "error";
      routeKey: string;
      sessionId: string | null;
      error: string;
    }
  | {
      type: "status_changed";
      routeKey: string;
      status: AcpAgentStatus;
    }
  | {
      type: "slash_commands_update";
      routeKey: string;
      sessionId: string;
      commands: SlashCommand[];
    }
  | {
      type: "plan_update";
      routeKey: string;
      sessionId: string;
      entries: AcpPlanEntry[];
    }
  | {
      type: "runtime_state_update";
      routeKey: string;
      sessionId: string | null;
      runtimeState: AcpRuntimeState;
    }
  | {
      type: "session_mode_update";
      routeKey: string;
      sessionId: string;
      modeState: SessionModeState;
    }
  | {
      type: "current_mode_update";
      routeKey: string;
      sessionId: string;
      currentModeId: string;
    }
  | {
      type: "prompt_complete";
      routeKey: string;
      sessionId: string;
      stopReason: StopReason;
    }
  | {
      type: "ui_action";
      routeKey: string;
      sessionId: string;
      action: UiAction;
    };

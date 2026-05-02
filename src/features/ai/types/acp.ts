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
  installRuntime: "node" | "python" | "go" | "rust" | "binary" | null;
  installPackage: string | null;
  canInstall: boolean;
}

export interface AcpAgentStatus {
  agentId: string;
  running: boolean;
  sessionActive: boolean;
  initialized: boolean;
  sessionId?: string | null;
  agentCapabilities?: AcpAgentCapabilities | null;
}

export interface AcpAgentCapabilities {
  loadSession: boolean;
  promptCapabilities: {
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
  };
  mcpCapabilities: {
    http: boolean;
    sse: boolean;
  };
  sessionCapabilities: unknown;
}

export type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string }
  | { type: "audio"; data: string; mediaType: string }
  | {
      type: "resource";
      uri: string;
      name: string | null;
      mimeType?: string | null;
      text?: string | null;
      blob?: string | null;
      title?: string | null;
      description?: string | null;
      size?: number | null;
    };

export type AcpPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string | null }
  | {
      type: "resource";
      resource:
        | { uri: string; text: string; mimeType?: string | null }
        | { uri: string; blob: string; mimeType?: string | null };
    };

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

export interface SessionConfigOptionValue {
  id: string;
  name: string;
  description?: string;
}

export type SessionConfigOption = {
  id: string;
  name: string;
  description?: string;
  kind: {
    type: "select";
    currentValue: string;
    options: SessionConfigOptionValue[];
  };
};

export interface SessionModeState {
  currentModeId: string | null;
  availableModes: SessionMode[];
}

export type AcpPlanEntryPriority = "high" | "medium" | "low";
export type AcpPlanEntryStatus = "pending" | "in_progress" | "completed";

export interface AcpPlanEntry {
  content: string;
  priority: AcpPlanEntryPriority;
  status: AcpPlanEntryStatus;
}

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  id: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export type AcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AcpToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpToolCallLocation {
  path: string;
  line?: number | null;
}

// Prompt turn types
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

// UI action types that agents can request
export type UiAction =
  | { action: "open_web_viewer"; url: string }
  | { action: "open_terminal"; command: string | null }
  | { action: "set_chat_title"; title: string };

export type AcpEvent =
  | {
      type: "user_message_chunk";
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "content_chunk";
      sessionId: string;
      content: AcpContentBlock;
      isComplete: boolean;
    }
  | {
      type: "thought_chunk";
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
      kind: AcpToolKind;
      status: AcpToolCallStatus;
      locations: AcpToolCallLocation[];
    }
  | {
      type: "tool_update";
      sessionId: string;
      toolId: string;
      toolName?: string | null;
      input?: unknown;
      output?: unknown;
      kind?: AcpToolKind | null;
      status?: AcpToolCallStatus | null;
      locations?: AcpToolCallLocation[] | null;
      error?: string | null;
    }
  | {
      type: "tool_complete";
      sessionId: string;
      toolId: string;
      success: boolean;
      output?: unknown;
      error?: string | null;
    }
  | {
      type: "permission_request";
      requestId: string;
      permissionType: string;
      resource: string;
      description: string;
      options: AcpPermissionOption[];
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
      type: "plan_update";
      sessionId: string;
      entries: AcpPlanEntry[];
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
      type: "config_options_update";
      sessionId: string;
      configOptions: SessionConfigOption[];
    }
  | {
      type: "session_info_update";
      sessionId: string;
      title: string | null;
      updatedAt: string | null;
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

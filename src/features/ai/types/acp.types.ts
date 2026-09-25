import type { AcpElicitationRequest } from "../lib/acp-elicitation";
import type { AcpSkippedMcpServer } from "@/features/ai/types/mcp-server.types";
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
  availableVersion: string | null;
  installedVersion: string | null;
  updateAvailable: boolean;
  managed: boolean;
  canInstall: boolean;
}

/**
 * One running agent process. Every chat that uses the same agent in the same workspace shares it,
 * each with its own session.
 */
export interface AcpAgentStatus {
  agentId: string;
  running: boolean;
  initialized: boolean;
  workspacePath?: string | null;
  /** The sessions open on the agent; for a stopped agent, the sessions it had. */
  sessionIds?: string[];
  agentCapabilities?: AcpAgentCapabilities | null;
  /** The sign-in methods the agent offered in `initialize`. */
  authMethods?: AcpAuthMethod[];
  /** Configured MCP servers left out because the agent does not support their transport. */
  skippedMcpServers?: AcpSkippedMcpServer[];
}

/** A chat's session, opened or found already open, and the agent that holds it. */
export interface AcpOpenedSession {
  sessionId: string;
  status: AcpAgentStatus;
  /**
   * The chat asked for its earlier session, but the agent could not restore it, so the chat
   * continues in a new session without the agent's earlier context.
   */
  contextLost?: boolean;
  /** The conversation an imported session replayed, as the events a live turn would emit. */
  history?: AcpEvent[];
}

/** What an ACP session advertises: its slash commands, modes and config options. */
export interface AcpSessionState {
  slashCommands: SlashCommand[];
  modeState: {
    currentModeId: string | null;
    availableModes: SessionMode[];
  };
  configOptions: SessionConfigOption[];
}

/** The command a terminal sign-in method runs in an Athas terminal. */
export interface AcpTerminalAuthLaunch {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * A way to sign in to an ACP agent. `agent` methods are completed by the agent through
 * `authenticate`; `terminal` methods are completed by the user running `terminal`.
 */
export interface AcpAuthMethod {
  id: string;
  name: string;
  description: string | null;
  kind: "agent" | "terminal";
  terminal: AcpTerminalAuthLaunch | null;
}

interface AcpAgentCapabilities {
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
  authCapabilities: unknown;
}

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
  _meta?: unknown;
}

export interface AcpSessionList {
  sessions: AcpSessionInfo[];
  nextCursor?: string | null;
}

type AcpContentBlock =
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
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string | null }
  | {
      type: "resource";
      resource:
        | { uri: string; text: string; mimeType?: string | null }
        | { uri: string; blob: string; mimeType?: string | null };
    };

// Slash command types
interface SlashCommandInput {
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

interface SessionConfigOptionValue {
  id: string;
  name: string;
  description?: string;
}

export type SessionConfigOption = {
  id: string;
  name: string;
  description?: string;
  category?: "mode" | "model" | "model_config" | "thought_level" | (string & {});
  kind:
    | {
        type: "select";
        currentValue: string;
        options: SessionConfigOptionValue[];
      }
    | {
        type: "boolean";
        currentValue: boolean;
      };
};

export type SessionConfigValue = string | boolean;

interface SessionModeState {
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

interface AcpUsageUpdate {
  used: number;
  size: number;
}

type AcpPermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

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

/** The tool call an ACP permission request is about, in the shapes tool cards use. */
export interface AcpPermissionToolCall {
  toolId: string;
  title?: string | null;
  kind?: AcpToolKind | null;
  /** The call's ACP `content`: diffs, terminals and content blocks. */
  content?: unknown;
  locations?: AcpToolCallLocation[] | null;
  rawInput?: unknown;
}

/** What a permission request is about to do, so the prompt can show it instead of describing it. */
export type AcpPermissionPreview =
  | { type: "diff"; path: string; oldText: string; newText: string }
  | { type: "command"; command: string; cwd?: string }
  | {
      /** An ACP agent's tool call, reduced to what the prompt shows. */
      type: "tool_call";
      title: string | null;
      kind: AcpToolKind | null;
      diffs: { path: string; oldText: string; newText: string }[];
      command: string | null;
      text: string | null;
      locations: AcpToolCallLocation[];
      inputSummary: string | null;
    };

// Prompt turn types
export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

// UI action types that agents can request
type UiAction =
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
      output?: unknown;
      rawOutput?: unknown;
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
      rawOutput?: unknown;
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
      sessionId: string;
      requestId: string;
      permissionType: string;
      resource: string;
      description: string;
      options: AcpPermissionOption[];
      preview?: AcpPermissionPreview;
      /** Sent by ACP agents: the tool call the request is about. */
      toolCall?: AcpPermissionToolCall;
    }
  | {
      type: "elicitation_request";
      /** Null when the agent asks outside a session (a request-scoped elicitation). */
      sessionId: string | null;
      requestId: string;
      request: AcpElicitationRequest;
    }
  | {
      /** The flow behind an accepted URL question finished. */
      type: "elicitation_complete";
      elicitationId: string;
    }
  | {
      /** A permission request or question stopped waiting before anyone answered it. */
      type: "request_closed";
      requestId: string;
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
      /** An agent started, stopped, or opened or closed a session. */
      type: "status_changed";
      status: AcpAgentStatus;
      /** Why an agent stopped on its own (it exited); null for a requested or idle stop. */
      error?: string | null;
    }
  | {
      type: "auth_required";
      agentId: string;
      /** Set when a prompt needed sign-in; startup failures carry none. */
      sessionId: string | null;
      methods: AcpAuthMethod[];
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
      type: "usage_update";
      sessionId: string;
      usage: AcpUsageUpdate;
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
      stopReason: AcpStopReason;
    }
  | {
      type: "ui_action";
      sessionId: string;
      action: UiAction;
    };

/** The ACP client asks each editor window what it holds for a file an agent is reading. */
export interface AcpBufferReadRequest {
  requestId: string;
  path: string;
}

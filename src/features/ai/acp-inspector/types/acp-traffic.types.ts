/** Which way a recorded line went: from the agent, to the agent, or the agent's stderr. */
export type AcpTrafficDirection = "in" | "out" | "stderr";

/** One line recorded by the Rust tap on an agent process's stdio. */
export interface AcpTrafficEntry {
  seq: number;
  timestampMs: number;
  direction: AcpTrafficDirection;
  /** The line with secrets redacted, cut short when `truncated`. */
  line: string;
  truncated: boolean;
  originalBytes: number;
  /** For a truncated line, the method it carried. */
  method?: string;
  /** For a truncated line, the JSON-RPC id it carried. */
  id?: string | number | null;
}

export interface AcpTrafficProcess {
  processKey: string;
  agentId: string;
  agentName: string;
  workspacePath: string | null;
  running: boolean;
  startedAtMs: number;
  entryCount: number;
}

export interface AcpInitializeExchange {
  request: unknown;
  response: unknown;
}

export interface AcpTrafficBacklog {
  process: AcpTrafficProcess;
  initialize: AcpInitializeExchange;
  entries: AcpTrafficEntry[];
}

/** The `acp-traffic` event payload. */
export type AcpTrafficEvent =
  | { type: "entry"; processKey: string; entry: AcpTrafficEntry }
  | { type: "process"; process: AcpTrafficProcess }
  | { type: "initialize"; processKey: string; initialize: AcpInitializeExchange };

export type AcpTrafficMessageKind = "request" | "response" | "notification" | "stderr" | "unknown";

/** One JSON-RPC message (or stderr line) shown in the inspector. A batch line yields several. */
export interface AcpTrafficMessage {
  key: string;
  seq: number;
  timestampMs: number;
  direction: AcpTrafficDirection;
  kind: AcpTrafficMessageKind;
  /** The method, inherited from the matching request for a response. */
  method: string | null;
  /** The JSON-RPC id, as JSON text so numbers and strings stay apart. */
  id: string | null;
  sessionId: string | null;
  /** The parsed message, or `null` for stderr and lines that could not be parsed. */
  payload: unknown;
  raw: string;
  truncated: boolean;
  isError: boolean;
  /** For a request, its response; for a response, its request. */
  partnerKey: string | null;
  latencyMs: number | null;
}

export type AcpTrafficDirectionFilter = "all" | AcpTrafficDirection;

export interface AcpTrafficFilter {
  query: string;
  direction: AcpTrafficDirectionFilter;
  /** A session id, or `null` for every session. */
  sessionId: string | null;
}

export interface AcpInitializeSummary {
  protocolVersion: unknown;
  clientInfo: unknown;
  clientCapabilities: unknown;
  agentInfo: unknown;
  agentCapabilities: unknown;
  authMethods: unknown;
  error: unknown;
}

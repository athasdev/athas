/** A JSON-RPC 2.0 message as MCP exchanges it. */
export interface McpJsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Moves MCP messages to and from one server; the client owns the protocol. */
export interface McpTransport {
  start(
    onMessage: (message: McpJsonRpcMessage) => void,
    onClose: (reason: string) => void,
  ): Promise<void>;
  send(message: McpJsonRpcMessage): Promise<void>;
  /** Told the negotiated protocol version, which HTTP requests must carry. */
  setProtocolVersion?(version: string): void;
  close(): Promise<void>;
}

/** A tool as an MCP server lists it in `tools/list`. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

/** A `tools/call` result reduced to what the model receives. */
export interface McpToolCallOutput {
  content: string;
  isError?: boolean;
  truncated?: boolean;
}

import type {
  McpJsonRpcMessage,
  McpToolCallOutput,
  McpToolInfo,
  McpTransport,
} from "../types/intelligence-mcp.types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Characters of one tool result the model receives. */
export const MCP_RESULT_CHARS = 20_000;
/** Tools taken from one server; a server listing more is cut off. */
const MAX_TOOLS_PER_SERVER = 100;
const MAX_LIST_PAGES = 10;
const MAX_DESCRIPTION_CHARS = 1_000;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A minimal MCP client: initialize, list tools and call them over any transport. */
export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closedReason: string | null = null;

  constructor(
    readonly serverName: string,
    private readonly transport: McpTransport,
  ) {}

  async connect(signal: AbortSignal, timeoutMs: number): Promise<void> {
    await this.transport.start(
      (message) => this.receive(message),
      (reason) => this.fail(reason),
    );
    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "athas", version: "1" },
      },
      signal,
      timeoutMs,
    );
    const version = isRecord(result) ? result.protocolVersion : undefined;
    this.transport.setProtocolVersion?.(
      typeof version === "string" ? version : MCP_PROTOCOL_VERSION,
    );
    await this.notify("notifications/initialized");
  }

  async listTools(signal: AbortSignal, timeoutMs: number): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, signal, timeoutMs);
      if (!isRecord(result) || !Array.isArray(result.tools)) break;
      for (const entry of result.tools) {
        const tool = toToolInfo(entry);
        if (tool) tools.push(tool);
      }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (!cursor || tools.length >= MAX_TOOLS_PER_SERVER) break;
    }
    return tools.slice(0, MAX_TOOLS_PER_SERVER);
  }

  async callTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<McpToolCallOutput> {
    const result = await this.request(
      "tools/call",
      { name, arguments: isRecord(args) ? args : {} },
      signal,
      timeoutMs,
    );
    return formatMcpToolResult(result);
  }

  async close(): Promise<void> {
    this.fail("closed");
    await this.transport.close().catch(() => undefined);
  }

  private async notify(method: string, params?: unknown) {
    await this.transport.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  private request(
    method: string,
    params: unknown,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closedReason) return Promise.reject(new Error(this.closedReason));
    if (signal.aborted) return Promise.reject(new Error("Stopped"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      const cancel = (reason: string) => {
        cleanup();
        void this.notify("notifications/cancelled", { requestId: id, reason }).catch(() => {});
        reject(new Error(reason));
      };
      const timer = setTimeout(
        () =>
          cancel(`${this.serverName} did not answer ${method} within ${timeoutMs / 1000} seconds.`),
        timeoutMs,
      );
      const abort = () => cancel("Stopped");
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (result) => {
          cleanup();
          resolve(result);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      this.transport
        .send({ jsonrpc: "2.0", id, method, params })
        .catch((error: unknown) =>
          this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error))),
        );
    });
  }

  private receive(message: McpJsonRpcMessage) {
    if (message.method) {
      // Requests from the server: answer pings, refuse the rest since no capability was offered.
      if (message.id === undefined || message.id === null) return;
      void this.transport
        .send(
          message.method === "ping"
            ? { jsonrpc: "2.0", id: message.id, result: {} }
            : {
                jsonrpc: "2.0",
                id: message.id,
                error: { code: -32601, message: `Athas does not support ${message.method}` },
              },
        )
        .catch(() => {});
      return;
    }
    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!pending) return;
    if (message.error) {
      pending.reject(new Error(message.error.message || `MCP error ${message.error.code}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private fail(reason: string) {
    if (this.closedReason) return;
    this.closedReason =
      reason === "closed" ? `${this.serverName} was closed.` : `${this.serverName}: ${reason}`;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(this.closedReason));
    }
  }
}

function toToolInfo(entry: unknown): McpToolInfo | null {
  if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name) return null;
  const annotations = isRecord(entry.annotations) ? entry.annotations : undefined;
  return {
    name: entry.name,
    ...(typeof entry.title === "string" ? { title: entry.title } : {}),
    ...(typeof entry.description === "string"
      ? { description: entry.description.slice(0, MAX_DESCRIPTION_CHARS) }
      : {}),
    inputSchema: normalizeMcpInputSchema(entry.inputSchema),
    ...(annotations
      ? {
          annotations: {
            readOnlyHint: annotations.readOnlyHint === true,
            destructiveHint: annotations.destructiveHint === true,
          },
        }
      : {}),
  };
}

/**
 * Tool inputs must be JSON Schema objects; providers reject a schema without `type: "object"`
 * or `properties`, so a missing or odd schema becomes an empty object schema.
 */
export function normalizeMcpInputSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema) || (schema.type !== undefined && schema.type !== "object")) {
    return { type: "object", properties: {} };
  }
  const rest = { ...schema };
  delete rest.$schema;
  return {
    ...rest,
    type: "object",
    properties: isRecord(schema.properties) ? schema.properties : {},
  };
}

function clipResult(text: string): { text: string; truncated: boolean } {
  if (text.length <= MCP_RESULT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MCP_RESULT_CHARS)}\n… [${text.length - MCP_RESULT_CHARS} more characters not shown]`,
    truncated: true,
  };
}

/** Joins a `tools/call` result's content into capped text the model can read. */
export function formatMcpToolResult(result: unknown): McpToolCallOutput {
  if (!isRecord(result)) return { content: "" };
  const parts: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (item.type === "image" || item.type === "audio")
      parts.push(
        `[${item.type} omitted${typeof item.mimeType === "string" ? `: ${item.mimeType}` : ""}]`,
      );
    else if (item.type === "resource" && isRecord(item.resource)) {
      const resource = item.resource;
      parts.push(
        typeof resource.text === "string"
          ? resource.text
          : `[resource ${typeof resource.uri === "string" ? resource.uri : ""}]`,
      );
    } else if (item.type === "resource_link" && typeof item.uri === "string")
      parts.push(`[resource ${item.uri}]`);
  }
  if (parts.length === 0 && result.structuredContent !== undefined)
    parts.push(JSON.stringify(result.structuredContent));
  const { text, truncated } = clipResult(parts.join("\n\n"));
  return {
    content: text,
    ...(result.isError === true ? { isError: true } : {}),
    ...(truncated ? { truncated } : {}),
  };
}

/**
 * Reads a `text/event-stream` body and reports each event. Comment lines are skipped and
 * multi-line `data` fields are joined, as the SSE format defines.
 */
export async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: { event: string; data: string }) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) onEvent({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };
  const handleLine = (line: string) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
  dispatch();
}

/** Parses one JSON-RPC payload, which HTTP servers may send as a batch array. */
export function parseMcpMessages(text: string): McpJsonRpcMessage[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((entry): entry is McpJsonRpcMessage => isRecord(entry));
  } catch {
    return [];
  }
}

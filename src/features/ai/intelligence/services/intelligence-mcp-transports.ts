import { Channel, invoke } from "@tauri-apps/api/core";
import { tauriFetch } from "@/utils/tauri-fetch";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";
import { getMcpServerSecrets } from "@/features/ai/services/mcp-server-secrets";
import { parseMcpMessages, readServerSentEvents } from "../lib/intelligence-mcp-client";
import type { McpJsonRpcMessage, McpTransport } from "../types/intelligence-mcp.types";

type StdioEvent =
  | { type: "message"; line: string }
  | { type: "closed"; code: number | null; stderr: string };

function lastLines(text: string, count = 3) {
  return text.trim().split("\n").slice(-count).join("\n");
}

/** A stdio server started by Rust, which relays newline-delimited JSON-RPC. */
export function createStdioMcpTransport(server: McpServerSetting, cwd?: string): McpTransport {
  const processId = `mcp:${crypto.randomUUID()}`;
  let started = false;
  let closed = false;
  const stop = () => invoke("intelligence_mcp_stop", { processId });
  return {
    async start(onMessage, onClose) {
      const channel = new Channel<StdioEvent>();
      channel.onmessage = (event) => {
        if (event.type === "message") {
          for (const message of parseMcpMessages(event.line)) onMessage(message);
          return;
        }
        const detail = lastLines(event.stderr);
        onClose(
          `the server exited${event.code !== null ? ` with code ${event.code}` : ""}${detail ? `: ${detail}` : "."}`,
        );
      };
      await invoke("intelligence_mcp_start", {
        processId,
        server,
        cwd: cwd ?? null,
        onEvent: channel,
      });
      started = true;
      // A run stopped or timed out while the server was starting; it must not outlive the run.
      if (closed) {
        await stop().catch(() => undefined);
        throw new Error("Stopped");
      }
    },
    send: (message) =>
      invoke("intelligence_mcp_send", { processId, message: JSON.stringify(message) }),
    async close() {
      closed = true;
      if (started) await stop();
    },
  };
}

async function secretHeaders(server: McpServerSetting): Promise<Record<string, string>> {
  const secrets = await getMcpServerSecrets(server.id).catch(() => ({ env: [], headers: [] }));
  return Object.fromEntries(
    secrets.headers
      .filter((entry) => entry.name.trim())
      .map((entry) => [entry.name.trim(), entry.value]),
  );
}

async function describeHttpError(response: Response) {
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 300);
  return `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
}

/** The error reply a failed POST stands in for, so the waiting request fails with the reason. */
function failedReply(message: McpJsonRpcMessage, reason: string): McpJsonRpcMessage | null {
  if (message.id === undefined || message.id === null || message.method === undefined) return null;
  return { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: reason } };
}

/** MCP's Streamable HTTP transport: every message is a POST answered with JSON or a stream. */
export function createHttpMcpTransport(server: McpServerSetting): McpTransport {
  const controller = new AbortController();
  let headers: Record<string, string> = {};
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  let receive: (message: McpJsonRpcMessage) => void = () => {};
  const requestHeaders = () => ({
    ...headers,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
  });
  return {
    async start(onMessage) {
      receive = onMessage;
      headers = await secretHeaders(server);
    },
    setProtocolVersion(version) {
      protocolVersion = version;
    },
    async send(message) {
      const response = await tauriFetch(server.url, {
        method: "POST",
        headers: {
          ...requestHeaders(),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (!response.ok) {
        const reply = failedReply(message, await describeHttpError(response));
        if (reply) receive(reply);
        return;
      }
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("text/event-stream") && response.body) {
        void readServerSentEvents(response.body, (event) => {
          if (event.event === "message")
            for (const entry of parseMcpMessages(event.data)) receive(entry);
        }).catch(() => {});
        return;
      }
      const text = await response.text();
      for (const entry of parseMcpMessages(text)) receive(entry);
    },
    async close() {
      controller.abort();
      if (!sessionId) return;
      await tauriFetch(server.url, { method: "DELETE", headers: requestHeaders() }).catch(
        () => undefined,
      );
    },
  };
}

/** The older HTTP+SSE transport: one event stream for replies, POSTs to the endpoint it names. */
export function createSseMcpTransport(server: McpServerSetting): McpTransport {
  const controller = new AbortController();
  let headers: Record<string, string> = {};
  let endpoint: string | null = null;
  let receive: (message: McpJsonRpcMessage) => void = () => {};
  return {
    async start(onMessage, onClose) {
      receive = onMessage;
      headers = await secretHeaders(server);
      const response = await tauriFetch(server.url, {
        method: "GET",
        headers: { ...headers, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(await describeHttpError(response));
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        readServerSentEvents(response.body!, (event) => {
          if (event.event === "endpoint" && !ready) {
            ready = true;
            endpoint = new URL(event.data.trim(), server.url).toString();
            resolve();
          } else if (event.event === "message") {
            for (const entry of parseMcpMessages(event.data)) receive(entry);
          }
        })
          .then(() => {
            if (!ready)
              reject(new Error("The server closed the event stream before it was ready."));
            else if (!controller.signal.aborted) onClose("the event stream ended.");
          })
          .catch((error: unknown) => {
            if (!ready) reject(error instanceof Error ? error : new Error(String(error)));
            else if (!controller.signal.aborted) onClose("the event stream failed.");
          });
      });
    },
    async send(message) {
      if (!endpoint) throw new Error("The MCP server is not connected.");
      const response = await tauriFetch(endpoint, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) {
        const reply = failedReply(message, await describeHttpError(response));
        if (reply) receive(reply);
        return;
      }
      await response.text().catch(() => "");
    },
    async close() {
      controller.abort();
    },
  };
}

export function createMcpTransport(server: McpServerSetting, cwd?: string): McpTransport {
  if (server.transport === "stdio") return createStdioMcpTransport(server, cwd);
  if (server.transport === "sse") return createSseMcpTransport(server);
  return createHttpMcpTransport(server);
}

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  secrets: vi.fn(),
  channels: [] as Array<{ onmessage: (event: unknown) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
    constructor() {
      mocks.channels.push(this);
    }
  },
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));
vi.mock("@/features/ai/services/mcp-server-secrets", () => ({
  getMcpServerSecrets: mocks.secrets,
}));

import { commands } from "@/bindings/commands";
import { createMcpTransport } from "../intelligence/services/intelligence-mcp-transports";
import type { McpJsonRpcMessage } from "../intelligence/types/intelligence-mcp.types";
import type { McpServerSetting } from "../types/mcp-server.types";

function server(transport: McpServerSetting["transport"], url = "https://mcp.test/mcp") {
  return {
    id: `id-${transport}`,
    name: transport,
    enabled: true,
    transport,
    command: "mcp-server",
    args: ["--stdio"],
    url,
  } as McpServerSetting;
}

function sseStream(chunks: string[], keepOpen = false) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!keepOpen) controller.close();
    },
  });
}

function collect() {
  const messages: McpJsonRpcMessage[] = [];
  const closes: string[] = [];
  return {
    messages,
    closes,
    onMessage: (message: McpJsonRpcMessage) => messages.push(message),
    onClose: (reason: string) => closes.push(reason),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.channels.length = 0;
  mocks.secrets.mockResolvedValue({
    env: [],
    headers: [
      { name: " Authorization ", value: "Bearer mcp-secret" },
      { name: "  ", value: "ignored" },
    ],
  });
  vi.spyOn(commands, "intelligenceMcpStart").mockResolvedValue(undefined as never);
  vi.spyOn(commands, "intelligenceMcpSend").mockResolvedValue(undefined as never);
  vi.spyOn(commands, "intelligenceMcpStop").mockResolvedValue(undefined as never);
});

describe("stdio MCP transport", () => {
  it("starts the server in the workspace and relays its JSON-RPC lines", async () => {
    const transport = createMcpTransport(server("stdio"), "/repo");
    const sink = collect();

    await transport.start(sink.onMessage, sink.onClose);
    const [processId, setting, cwd] = vi.mocked(commands.intelligenceMcpStart).mock.calls[0];
    expect(processId).toMatch(/^mcp:/);
    expect(setting).toMatchObject({ command: "mcp-server" });
    expect(cwd).toBe("/repo");

    mocks.channels[0].onmessage({
      type: "message",
      line: '[{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","method":"note"}]',
    });
    mocks.channels[0].onmessage({ type: "message", line: "not json" });
    expect(sink.messages).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", method: "note" },
    ]);

    await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(commands.intelligenceMcpSend).toHaveBeenCalledWith(
      processId,
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    );

    await transport.close();
    expect(commands.intelligenceMcpStop).toHaveBeenCalledWith(processId);
  });

  it("explains why the server exited with the end of its stderr", async () => {
    const transport = createMcpTransport(server("stdio"));
    const sink = collect();
    await transport.start(sink.onMessage, sink.onClose);

    mocks.channels[0].onmessage({ type: "exit", code: 1, stderr: "a\nb\nc\nModule not found\n" });
    mocks.channels[0].onmessage({ type: "exit", code: null, stderr: "" });

    expect(sink.closes).toEqual([
      "the server exited with code 1: b\nc\nModule not found",
      "the server exited.",
    ]);
    expect(vi.mocked(commands.intelligenceMcpStart).mock.calls[0][2]).toBeNull();
  });

  it("does not stop a server that never started", async () => {
    const transport = createMcpTransport(server("stdio"));
    await transport.close();
    expect(commands.intelligenceMcpStop).not.toHaveBeenCalled();
  });
});

describe("Streamable HTTP MCP transport", () => {
  it("posts messages with secret headers and tracks the session", async () => {
    const transport = createMcpTransport(server("http"));
    const sink = collect();
    await transport.start(sink.onMessage, sink.onClose);
    transport.setProtocolVersion?.("2025-06-18");

    mocks.fetch.mockResolvedValueOnce(
      new Response('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', {
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
      }),
    );
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

    mocks.fetch.mockResolvedValueOnce(new Response("", { status: 202 }));
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    expect(sink.messages).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
    const [url, first] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mcp.test/mcp");
    expect(first.method).toBe("POST");
    expect(first.headers).toMatchObject({
      Authorization: "Bearer mcp-secret",
      "MCP-Protocol-Version": "2025-06-18",
      Accept: "application/json, text/event-stream",
    });
    expect(first.headers).not.toHaveProperty("Mcp-Session-Id");
    expect((mocks.fetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      "Mcp-Session-Id": "sess-1",
    });

    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await transport.close();
    const [, closing] = mocks.fetch.mock.calls[2] as [string, RequestInit];
    expect(closing.method).toBe("DELETE");
    expect(closing.headers).toMatchObject({ "Mcp-Session-Id": "sess-1" });
  });

  it("reads replies from an event stream", async () => {
    const transport = createMcpTransport(server("http"));
    const sink = collect();
    await transport.start(sink.onMessage, sink.onClose);
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        sseStream([
          'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\n\n',
          "event: ping\ndata: {}\n\n",
        ]),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );

    await transport.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    await flush();

    expect(sink.messages).toEqual([{ jsonrpc: "2.0", id: 3, result: { tools: [] } }]);
  });

  it("fails the waiting request with the HTTP error", async () => {
    mocks.secrets.mockRejectedValue(new Error("keychain"));
    const transport = createMcpTransport(server("http"));
    const sink = collect();
    await transport.start(sink.onMessage, sink.onClose);

    mocks.fetch.mockResolvedValueOnce(new Response("Unauthorized: bad token", { status: 401 }));
    await transport.send({ jsonrpc: "2.0", id: 9, method: "tools/call" });
    mocks.fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    await transport.send({ jsonrpc: "2.0", method: "notifications/cancelled" });

    expect(sink.messages).toEqual([
      {
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32000, message: "HTTP 401: Unauthorized: bad token" },
      },
    ]);
    expect((mocks.fetch.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
      "Authorization",
    );

    await transport.close();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("HTTP+SSE MCP transport", () => {
  it("connects to the endpoint the stream names and relays messages", async () => {
    const transport = createMcpTransport(server("sse", "https://mcp.test/sse"));
    const sink = collect();
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        sseStream(
          [
            "event: endpoint\ndata: /messages?session=abc\n\n",
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
          ],
          true,
        ),
      ),
    );

    await transport.start(sink.onMessage, sink.onClose);
    await flush();

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mcp.test/sse");
    expect(init.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer mcp-secret",
    });
    expect(sink.messages).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);

    mocks.fetch.mockResolvedValueOnce(new Response("Accepted", { status: 202 }));
    await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(mocks.fetch.mock.calls[1][0]).toBe("https://mcp.test/messages?session=abc");

    mocks.fetch.mockResolvedValueOnce(new Response("gone", { status: 410 }));
    await transport.send({ jsonrpc: "2.0", id: 3, method: "tools/call" });
    expect(sink.messages[sink.messages.length - 1]).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "HTTP 410: gone" },
    });

    await transport.close();
    expect(sink.closes).toEqual([]);
  });

  it("reports when the event stream ends after connecting", async () => {
    const transport = createMcpTransport(server("sse"));
    const sink = collect();
    mocks.fetch.mockResolvedValueOnce(new Response(sseStream(["event: endpoint\ndata: /m\n\n"])));

    await transport.start(sink.onMessage, sink.onClose);
    await flush();

    expect(sink.closes).toEqual(["the event stream ended."]);
  });

  it("fails to start when the stream closes before naming an endpoint", async () => {
    const transport = createMcpTransport(server("sse"));
    mocks.fetch.mockResolvedValueOnce(new Response(sseStream([": keepalive\n\n"])));
    await expect(transport.start(vi.fn(), vi.fn())).rejects.toThrow(
      "The server closed the event stream before it was ready.",
    );
  });

  it("fails to start on an HTTP error", async () => {
    const transport = createMcpTransport(server("sse"));
    mocks.fetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(transport.start(vi.fn(), vi.fn())).rejects.toThrow("HTTP 403: Forbidden");
  });

  it("refuses to send before connecting", async () => {
    const transport = createMcpTransport(server("sse"));
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "x" })).rejects.toThrow(
      "The MCP server is not connected.",
    );
  });

  it("reports a broken stream", async () => {
    const transport = createMcpTransport(server("sse"));
    const sink = collect();
    let fail: (error: Error) => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /m\n\n"));
        fail = (error) => controller.error(error);
      },
    });
    mocks.fetch.mockResolvedValueOnce(new Response(body));

    await transport.start(sink.onMessage, sink.onClose);
    fail(new Error("reset"));
    await flush();

    expect(sink.closes).toEqual(["the event stream failed."]);
  });
});

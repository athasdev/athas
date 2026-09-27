import { describe, expect, it, vi } from "vite-plus/test";
import {
  formatMcpToolResult,
  McpClient,
  MCP_RESULT_CHARS,
  normalizeMcpInputSchema,
  readServerSentEvents,
} from "../intelligence/lib/intelligence-mcp-client";
import { getExtraTools, type McpToolContext } from "../intelligence/services/intelligence-mcp";
import { createStdioMcpTransport } from "../intelligence/services/intelligence-mcp-transports";
import type { McpJsonRpcMessage, McpTransport } from "../intelligence/types/intelligence-mcp.types";
import type { McpServerSetting } from "../types/mcp-server.types";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke, Channel: class {} }));

interface FakeTool {
  name: string;
  readOnly?: boolean;
  reply?: (args: unknown) => unknown;
}

/** An in-memory MCP server that answers the way a real one does. */
function fakeServer(tools: FakeTool[], options: { failStart?: string; silent?: string[] } = {}) {
  const sent: McpJsonRpcMessage[] = [];
  let deliver: (message: McpJsonRpcMessage) => void = () => {};
  const transport: McpTransport & { closed: boolean; sent: McpJsonRpcMessage[] } = {
    closed: false,
    sent,
    async start(onMessage) {
      if (options.failStart) throw new Error(options.failStart);
      deliver = onMessage;
    },
    async send(message) {
      sent.push(message);
      if (message.id === undefined || !message.method) return;
      if (options.silent?.includes(message.method)) return;
      const reply = (result: unknown) =>
        queueMicrotask(() => deliver({ jsonrpc: "2.0", id: message.id, result }));
      if (message.method === "initialize") reply({ protocolVersion: "2025-06-18" });
      if (message.method === "tools/list") {
        const cursor = (message.params as { cursor?: string }).cursor;
        const page = cursor ? tools.slice(1) : tools.slice(0, 1);
        reply({
          tools: page.map((entry) => ({
            name: entry.name,
            description: `${entry.name} tool`,
            inputSchema: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: { q: { type: "string" } },
            },
            ...(entry.readOnly ? { annotations: { readOnlyHint: true } } : {}),
          })),
          ...(cursor || tools.length < 2 ? {} : { nextCursor: "page-2" }),
        });
      }
      if (message.method === "tools/call") {
        const { name, arguments: args } = message.params as { name: string; arguments: unknown };
        const tool = tools.find((entry) => entry.name === name);
        reply(tool?.reply?.(args) ?? { content: [{ type: "text", text: `ran ${name}` }] });
      }
    },
    async close() {
      transport.closed = true;
    },
  };
  return transport;
}

const server = (name: string, id = `${name}-id`): McpServerSetting => ({
  id,
  name,
  enabled: true,
  transport: "stdio",
  command: "server",
  args: [],
  url: "",
});

function context(
  transports: Record<string, McpTransport>,
  overrides: Partial<McpToolContext> = {},
): McpToolContext {
  return {
    signal: new AbortController().signal,
    readOnly: false,
    authorize: async () => true,
    track: (_name, _input, _id, execute) => execute(),
    servers: Object.keys(transports).map((name) => server(name)),
    createTransport: (setting) => transports[setting.name],
    ...overrides,
  };
}

async function call(tools: Record<string, unknown>, name: string, input: unknown) {
  const entry = tools[name] as {
    execute: (input: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
  };
  return entry.execute(input, { toolCallId: "call-1", messages: [] });
}

describe("MCP client", () => {
  it("initializes, pages through tools and calls one", async () => {
    const transport = fakeServer([{ name: "search" }, { name: "create_issue" }]);
    const client = new McpClient("github", transport);
    const signal = new AbortController().signal;

    await client.connect(signal, 1000);
    const tools = await client.listTools(signal, 1000);
    const output = await client.callTool("search", { q: "bug" }, signal, 1000);

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
      "tools/call",
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(["search", "create_issue"]);
    expect(tools[0].inputSchema).not.toHaveProperty("$schema");
    expect(output).toEqual({ content: "ran search" });
  });

  it("gives up on a silent server and tells it the request was cancelled", async () => {
    const transport = fakeServer([], { silent: ["tools/list"] });
    const client = new McpClient("slow", transport);
    const signal = new AbortController().signal;
    await client.connect(signal, 1000);

    await expect(client.listTools(signal, 10)).rejects.toThrow(/did not answer tools\/list/);
    expect(transport.sent[transport.sent.length - 1]).toMatchObject({
      method: "notifications/cancelled",
      params: { requestId: 2 },
    });
  });

  it("answers pings and refuses other server requests", async () => {
    let deliver: (message: McpJsonRpcMessage) => void = () => {};
    const sent: McpJsonRpcMessage[] = [];
    const client = new McpClient("server", {
      async start(onMessage) {
        deliver = onMessage;
      },
      async send(message) {
        sent.push(message);
      },
      async close() {},
    });
    void client.connect(new AbortController().signal, 1000).catch(() => {});
    await Promise.resolve();

    deliver({ jsonrpc: "2.0", id: "a", method: "ping" });
    deliver({ jsonrpc: "2.0", id: "b", method: "sampling/createMessage" });
    await Promise.resolve();

    expect(sent).toContainEqual({ jsonrpc: "2.0", id: "a", result: {} });
    expect(sent.find((message) => message.id === "b")?.error?.code).toBe(-32601);
    await client.close();
  });

  it("fails pending requests when the server exits", async () => {
    let close: (reason: string) => void = () => {};
    const client = new McpClient("crashy", {
      async start(_onMessage, onClose) {
        close = onClose;
      },
      async send() {},
      async close() {},
    });
    const pending = client.connect(new AbortController().signal, 1000);
    await Promise.resolve();
    close("the server exited with code 1: missing token");

    await expect(pending).rejects.toThrow("crashy: the server exited with code 1: missing token");
  });

  it("joins result content and caps it", () => {
    expect(
      formatMcpToolResult({
        content: [
          { type: "text", text: "first" },
          { type: "image", mimeType: "image/png", data: "..." },
          { type: "resource", resource: { uri: "file:///a", text: "inline" } },
        ],
        isError: true,
      }),
    ).toEqual({ content: "first\n\n[image omitted: image/png]\n\ninline", isError: true });
    expect(formatMcpToolResult({ content: [], structuredContent: { ok: 1 } }).content).toBe(
      '{"ok":1}',
    );

    const long = formatMcpToolResult({ content: [{ type: "text", text: "x".repeat(50_000) }] });
    expect(long.truncated).toBe(true);
    expect(long.content.length).toBeLessThan(MCP_RESULT_CHARS + 100);
  });

  it("turns missing or odd input schemas into empty object schemas", () => {
    expect(normalizeMcpInputSchema(undefined)).toEqual({ type: "object", properties: {} });
    expect(normalizeMcpInputSchema({ type: "string" })).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeMcpInputSchema({ required: ["q"] })).toEqual({
      type: "object",
      properties: {},
      required: ["q"],
    });
  });

  it("reads server-sent events split across chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = ["event: endpoint\ndata: /mes", 'sages?s=1\n\n: comment\ndata: {"a"', ":1}\n\n"];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const events: { event: string; data: string }[] = [];
    await readServerSentEvents(body, (event) => events.push(event));

    expect(events).toEqual([
      { event: "endpoint", data: "/messages?s=1" },
      { event: "message", data: '{"a":1}' },
    ]);
  });
});

describe("MCP tools for the built-in agent", () => {
  it("offers every server's tools under namespaced names", async () => {
    const extra = await getExtraTools(
      "/project",
      context({
        github: fakeServer([{ name: "search" }, { name: "create_issue" }]),
        "Linear App": fakeServer([{ name: "list" }]),
      }),
    );

    expect(Object.keys(extra.tools).sort()).toEqual([
      "mcp__Linear_App__list",
      "mcp__github__create_issue",
      "mcp__github__search",
    ]);
    expect(extra.notices).toEqual([]);
  });

  it("reports servers that fail to start and stops the rest when closed", async () => {
    const good = fakeServer([{ name: "search" }]);
    const extra = await getExtraTools(
      undefined,
      context({ good, broken: fakeServer([], { failStart: "command not found: nope" }) }),
    );

    expect(Object.keys(extra.tools)).toEqual(["mcp__good__search"]);
    expect(extra.notices).toEqual(["MCP server broken is unavailable: command not found: nope"]);
    await extra.close();
    expect(good.closed).toBe(true);
  });

  it("asks before every call and returns the server's answer", async () => {
    const authorize = vi.fn(async () => true);
    const track = vi.fn(
      (_name: string, _input: unknown, _id: string, execute: () => Promise<unknown>) => execute(),
    );
    const extra = await getExtraTools(
      "/project",
      context({ github: fakeServer([{ name: "search" }]) }, { authorize, track }),
    );

    await expect(call(extra.tools, "mcp__github__search", { q: "bug" })).resolves.toEqual({
      content: "ran search",
    });
    expect(authorize).toHaveBeenCalledWith({
      serverId: "github-id",
      serverName: "github",
      tool: "search",
      name: "mcp__github__search",
      input: { q: "bug" },
    });
    expect(track).toHaveBeenCalledWith(
      "mcp__github__search",
      { q: "bug" },
      "call-1",
      expect.any(Function),
    );
  });

  it("does not call the server when the user declines", async () => {
    const transport = fakeServer([{ name: "delete_repo" }]);
    const extra = await getExtraTools(
      "/project",
      context({ github: transport }, { authorize: async () => false }),
    );

    await expect(call(extra.tools, "mcp__github__delete_repo", {})).resolves.toEqual({
      executed: false,
      reason: "The user declined the tool call.",
    });
    expect(transport.sent.some((message) => message.method === "tools/call")).toBe(false);
  });

  it("surfaces tool errors as failures", async () => {
    const extra = await getExtraTools(
      "/project",
      context({
        github: fakeServer([
          {
            name: "search",
            reply: () => ({ content: [{ type: "text", text: "rate limited" }], isError: true }),
          },
        ]),
      }),
    );

    await expect(call(extra.tools, "mcp__github__search", {})).rejects.toThrow("rate limited");
  });

  it("offers only read-only tools in plan mode", async () => {
    const extra = await getExtraTools(
      "/project",
      context(
        { github: fakeServer([{ name: "search", readOnly: true }, { name: "create_issue" }]) },
        { readOnly: true },
      ),
    );

    expect(Object.keys(extra.tools)).toEqual(["mcp__github__search"]);
  });

  it("skips disabled and incomplete servers", async () => {
    const createTransport = vi.fn();
    const extra = await getExtraTools(
      "/project",
      context(
        {},
        {
          createTransport,
          servers: [
            { ...server("off"), enabled: false },
            { ...server("remote"), transport: "http", url: "" },
          ],
        },
      ),
    );

    expect(extra.tools).toEqual({});
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("stdio MCP transport", () => {
  it("stops a server that finished starting after its run was closed", async () => {
    let finishStart: () => void = () => {};
    tauri.invoke.mockImplementation((command: string) =>
      command === "intelligence_mcp_start"
        ? new Promise<void>((resolve) => {
            finishStart = resolve;
          })
        : Promise.resolve(),
    );
    const transport = createStdioMcpTransport({
      id: "slow",
      name: "slow",
      enabled: true,
      transport: "stdio",
      command: "slow-server",
      args: [],
      url: "",
    });
    const starting = transport.start(
      () => {},
      () => {},
    );
    await transport.close();
    expect(tauri.invoke).not.toHaveBeenCalledWith("intelligence_mcp_stop", expect.anything());

    finishStart();
    await expect(starting).rejects.toThrow("Stopped");
    expect(tauri.invoke).toHaveBeenCalledWith("intelligence_mcp_stop", {
      processId: expect.stringMatching(/^mcp:/),
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runIntelligenceAgent } from "../intelligence/services/intelligence-agent";
import { cancelIntelligenceAgent } from "../intelligence/services/intelligence-agent-session";
import { respondToIntelligencePermission } from "../intelligence/services/intelligence-agent-permissions";
import { formatApiError } from "../lib/api-error";
import type { McpToolContext } from "../intelligence/services/intelligence-mcp";
import type { McpJsonRpcMessage } from "../intelligence/types/intelligence-mcp.types";
import type { McpServerSetting } from "../types/mcp-server.types";

const mocks = vi.hoisted(() => ({
  model: null as unknown as MockLanguageModelV4,
  invoke: vi.fn(),
  recordWrite: vi.fn(),
  dirty: false,
  backgroundDirty: false,
  mcpServers: [] as McpServerSetting[],
  mcpCalls: [] as unknown[],
  mcpClosed: 0,
}));
vi.mock("../intelligence/services/intelligence-mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intelligence/services/intelligence-mcp")>();
  return {
    ...actual,
    getExtraTools: (root: string | undefined, context: McpToolContext) =>
      actual.getExtraTools(root, {
        ...context,
        servers: mocks.mcpServers,
        createTransport: () => {
          let deliver: (message: McpJsonRpcMessage) => void = () => {};
          return {
            start: async (onMessage) => {
              deliver = onMessage;
            },
            send: async (message) => {
              if (message.id === undefined) return;
              if (message.method === "tools/call") mocks.mcpCalls.push(message.params);
              const result =
                message.method === "tools/list"
                  ? { tools: [{ name: "search", inputSchema: { type: "object" } }] }
                  : message.method === "tools/call"
                    ? { content: [{ type: "text", text: "3 issues" }] }
                    : {};
              queueMicrotask(() => deliver({ jsonrpc: "2.0", id: message.id, result }));
            },
            close: async () => {
              mocks.mcpClosed++;
            },
          };
        },
      }),
  };
});
vi.mock("@/features/ai/services/agent-edits-service", () => ({
  recordAgentFileWrite: mocks.recordWrite,
}));
vi.mock("../intelligence/services/intelligence-sdk-model", () => ({
  getIntelligenceSdkModel: async () => mocks.model,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/workspace/runtime/workspace-runtime-registry", () => ({
  workspaceRuntimeRegistry: {
    getExistingStores: () =>
      mocks.backgroundDirty
        ? [
            {
              getState: () => ({
                buffers: [{ path: "/project/file.ts", type: "editor", isDirty: true }],
              }),
            },
          ]
        : [],
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: mocks.dirty ? [{ path: "/project/file.ts", type: "editor", isDirty: true }] : [],
    }),
  },
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: { subscribe: () => () => {} },
}));
vi.mock("../intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { subscribe: () => () => {} },
}));

const written = {
  writeId: 7,
  path: "/project/file.ts",
  previousContent: "const old = 1;",
  content: "const value = 1;",
};
const edit = { path: "file.ts", edits: [{ oldText: "old", newText: "value" }] };
const storage = new Map<string, string>();
const called = (command: string) => mocks.invoke.mock.calls.some(([name]) => name === command);

function step(name?: string, input: Record<string, unknown> = {}) {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks: [
        ...(name
          ? [
              {
                type: "tool-call" as const,
                toolCallId: name,
                toolName: name,
                input: JSON.stringify(input),
              },
            ]
          : [
              { type: "text-start" as const, id: "text" },
              { type: "text-delta" as const, id: "text", delta: "Finished" },
              { type: "text-end" as const, id: "text" },
            ]),
        {
          type: "finish" as const,
          finishReason: {
            unified: name ? ("tool-calls" as const) : ("stop" as const),
            raw: undefined,
          },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
        },
      ],
    }),
  };
}
const params = () => ({
  sessionId: "test-session",
  providerId: "openrouter",
  modelId: "user/model",
  root: "/project",
  readOnly: false,
  messages: [{ role: "user" as const, content: "Edit the file" }],
  onChunk: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dirty = false;
  mocks.backgroundDirty = false;
  mocks.mcpServers = [];
  mocks.mcpCalls = [];
  mocks.mcpClosed = 0;
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "intelligence_read_file"
      ? "const old = 1;"
      : command === "intelligence_edit_file"
        ? written
        : undefined,
  );
  mocks.model = new MockLanguageModelV4({
    doStream: [step("read_file", { path: "file.ts" }), step("edit_file", edit), step()],
  });
});

describe("Intelligence local agent loop", () => {
  it.each(["athas", "openai"])(
    "preserves system instructions across tool steps for %s",
    async (providerId) => {
      const options = params();
      await runIntelligenceAgent({
        ...options,
        providerId,
        messages: [
          { role: "system", content: "Follow repository instructions." },
          { role: "system", content: "Keep changes focused." },
          ...options.messages,
        ],
        onPermissionRequest: (event) => respondToIntelligencePermission(event.requestId, true),
      });
      expect(options.onChunk).toHaveBeenCalledWith("Finished");
      expect(mocks.model.doStreamCalls).toHaveLength(3);
      for (const call of mocks.model.doStreamCalls) {
        expect(call.prompt.filter((message) => message.role === "system")).toEqual([
          { role: "system", content: "Follow repository instructions." },
          { role: "system", content: "Keep changes focused." },
        ]);
      }
    },
  );
  it("lands an edit at once on the read version and records it for review", async () => {
    const options = params();
    const permission = vi.fn();
    const result = await runIntelligenceAgent({ ...options, onPermissionRequest: permission });
    expect(result).toMatchObject({
      outcome: "completed",
      stopReason: "end_turn",
      steps: 3,
      usage: { inputTokens: 3, outputTokens: 3 },
    });
    expect(permission).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("intelligence_edit_file", {
      root: "/project",
      path: "file.ts",
      expectedContent: "const old = 1;",
      edits: [{ oldText: "old", newText: "value" }],
    });
    expect(mocks.recordWrite).toHaveBeenCalledWith("test-session", written);
    expect(options.onChunk).toHaveBeenCalledWith("Finished");
  });
  it("edits again from what it wrote without another read", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [
        step("read_file", { path: "file.ts" }),
        step("edit_file", edit),
        step("edit_file", { path: "file.ts", edits: [{ oldText: "value", newText: "next" }] }),
        step(),
      ],
    });
    await runIntelligenceAgent(params());
    const edits = mocks.invoke.mock.calls.filter(([name]) => name === "intelligence_edit_file");
    expect(edits[1][1]).toMatchObject({ expectedContent: "const value = 1;" });
  });
  it("refuses to edit a file it has not read", async () => {
    mocks.model = new MockLanguageModelV4({ doStream: [step("edit_file", edit), step()] });
    const complete = vi.fn();
    await runIntelligenceAgent({ ...params(), onToolComplete: complete });
    expect(complete).toHaveBeenCalledWith("edit_file", "edit_file", undefined, expect.any(String));
    expect(called("intelligence_edit_file")).toBe(false);
  });
  it("does not overwrite an unsaved editor buffer", async () => {
    mocks.dirty = true;
    const complete = vi.fn();
    await runIntelligenceAgent({ ...params(), onToolComplete: complete });
    expect(complete).toHaveBeenCalledWith(
      "edit_file",
      "edit_file",
      undefined,
      expect.stringContaining("unsaved changes"),
    );
    expect(called("intelligence_edit_file")).toBe(false);
  });
  it("does not apply an edit after the user stops", async () => {
    const complete = vi.fn();
    expect(
      await runIntelligenceAgent({
        ...params(),
        onToolComplete: complete,
        onToolUse: (event) => {
          if (event.toolName === "edit_file") cancelIntelligenceAgent("test-session");
        },
      }),
    ).toMatchObject({ outcome: "cancelled", stopReason: "cancelled" });
    expect(called("intelligence_edit_file")).toBe(false);
    expect(complete).toHaveBeenCalledWith("edit_file", "edit_file", undefined, "Stopped");
  });
  it("omits mutation tools in plan mode", async () => {
    mocks.model = new MockLanguageModelV4({ doStream: [step()] });
    await runIntelligenceAgent({ ...params(), readOnly: true });
    const names = mocks.model.doStreamCalls[0].tools?.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["read_file", "search_files", "todo_write"]));
    for (const name of ["edit_file", "write_file", "delete_file", "run_command"])
      expect(names).not.toContain(name);
  });
  it("protects unsaved files in background workspaces", async () => {
    mocks.backgroundDirty = true;
    await runIntelligenceAgent(params());
    expect(called("intelligence_edit_file")).toBe(false);
  });
  it("asks before deleting a file and deletes only after approval", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [
        step("read_file", { path: "file.ts" }),
        step("delete_file", { path: "file.ts" }),
        step(),
      ],
    });
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => {
        expect(event.permissionType).toBe("intelligence-delete");
        expect(called("intelligence_delete_file")).toBe(false);
        respondToIntelligencePermission(event.requestId, true);
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("intelligence_delete_file", {
      root: "/project",
      path: "file.ts",
      expectedContent: "const old = 1;",
    });
  });
  it("runs a command only after showing it for approval", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [step("run_command", { command: "bun test" }), step()],
    });
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => {
        expect(event.description).toContain("bun test");
        expect(event.options.map((option) => option.kind)).toContain("allow_always");
        expect(mocks.invoke).not.toHaveBeenCalled();
        respondToIntelligencePermission(event.requestId, true);
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "intelligence_run_command",
      expect.objectContaining({ command: "bun test", root: "/project" }),
    );
  });
  it("never executes a declined command", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [step("run_command", { command: "bun test" }), step()],
    });
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => respondToIntelligencePermission(event.requestId, false),
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("runs read-only commands and always-allowed prefixes without asking", async () => {
    const permission = vi.fn((event) =>
      respondToIntelligencePermission(event.requestId, true, "allow_always"),
    );
    mocks.model = new MockLanguageModelV4({
      doStream: [
        step("run_command", { command: "git status" }),
        step("run_command", { command: "bun test src" }),
        step("run_command", { command: "bun test other" }),
        step("run_command", { command: "bun test; rm -rf src" }),
        step(),
      ],
    });
    await runIntelligenceAgent({ ...params(), onPermissionRequest: permission });
    const prompted = permission.mock.calls.map(([event]) => event.preview.command);
    expect(prompted).toEqual(["bun test src", "bun test; rm -rf src"]);
    expect(
      permission.mock.calls[1][0].options.map((option: { kind: string }) => option.kind),
    ).not.toContain("allow_always");
    const ran = mocks.invoke.mock.calls
      .filter(([name]) => name === "intelligence_run_command")
      .map(([, args]) => args.command);
    expect(ran).toEqual(["git status", "bun test src", "bun test other", "bun test; rm -rf src"]);
  });
  it("calls MCP tools after approval and remembers an always-allowed tool", async () => {
    mocks.mcpServers = [
      {
        id: "gh",
        name: "github",
        enabled: true,
        transport: "stdio",
        command: "github-mcp",
        args: [],
        url: "",
      },
    ];
    mocks.model = new MockLanguageModelV4({
      doStream: [
        step("mcp__github__search", { q: "bug" }),
        step("mcp__github__search", { q: "crash" }),
        step(),
      ],
    });
    const permission = vi.fn((event) =>
      respondToIntelligencePermission(event.requestId, true, "allow_always"),
    );
    const onToolUse = vi.fn();
    const complete = vi.fn();
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: permission,
      onToolUse,
      onToolComplete: complete,
    });

    expect(permission).toHaveBeenCalledOnce();
    expect(permission.mock.calls[0][0]).toMatchObject({
      permissionType: "intelligence-mcp",
      resource: "github",
    });
    expect(permission.mock.calls[0][0].description).toContain('"q": "bug"');
    expect(mocks.mcpCalls).toEqual([
      { name: "search", arguments: { q: "bug" } },
      { name: "search", arguments: { q: "crash" } },
    ]);
    expect(onToolUse).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "mcp__github__search", kind: "other" }),
    );
    expect(complete).toHaveBeenCalledWith("mcp__github__search", "mcp__github__search", {
      content: "3 issues",
    });
    expect(mocks.mcpClosed).toBe(1);
  });
  it("pauses with a Continue outcome when the step budget runs out", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [step("read_file", { path: "file.ts" }), step("read_file", { path: "file.ts" })],
    });
    const options = params();
    expect(await runIntelligenceAgent({ ...options, maxSteps: 2 })).toMatchObject({
      outcome: "completed",
      stopReason: "max_turn_requests",
      steps: 2,
    });
    expect(mocks.model.doStreamCalls).toHaveLength(2);
  });
  it("turns a stream error chunk into an error the chat can act on", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            initialDelayInMs: null,
            chunkDelayInMs: null,
            chunks: [
              {
                type: "error" as const,
                error: { message: "Your allowance is used up.", code: "allowance_exhausted" },
              },
            ],
          }),
        },
      ],
    });
    const failure = await runIntelligenceAgent(params()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: "Your allowance is used up.",
      code: "allowance_exhausted",
      statusCode: 402,
    });
    expect(formatApiError("athas", failure)).toContain("athas API error: 402|||");
  });
  it("sends the todo list to the chat as a plan", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [
        step("todo_write", {
          todos: [
            { content: "Read the file", status: "completed" },
            { content: "Edit it", status: "in_progress" },
          ],
        }),
        step(),
      ],
    });
    const onEvent = vi.fn();
    await runIntelligenceAgent({ ...params(), onEvent });
    expect(onEvent).toHaveBeenCalledWith({
      type: "plan_update",
      sessionId: "test-session",
      entries: [
        { content: "Read the file", status: "completed", priority: "medium" },
        { content: "Edit it", status: "in_progress", priority: "medium" },
      ],
    });
  });
  it("leaves images out for Athas hosted models and says so", async () => {
    mocks.model = new MockLanguageModelV4({ doStream: [step()] });
    const options = params();
    const result = await runIntelligenceAgent({
      ...options,
      providerId: "athas",
      messages: [
        {
          role: "user",
          content: "What is this?",
          images: [{ data: "abc", mediaType: "image/png" }],
        },
      ],
    });
    expect(result.notices).toEqual([expect.stringContaining("Images were not sent")]);
    const prompt = JSON.stringify(mocks.model.doStreamCalls[0].prompt);
    expect(prompt).not.toContain("image/png");
    expect(options.onChunk).toHaveBeenCalledWith(expect.stringContaining("Images were not sent"));
  });
});

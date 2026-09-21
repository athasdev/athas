import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runIntelligenceAgent } from "../intelligence/services/intelligence-agent";
import { cancelIntelligenceAgent } from "../intelligence/services/intelligence-agent-session";
import { respondToIntelligencePermission } from "../intelligence/services/intelligence-agent-permissions";

const mocks = vi.hoisted(() => ({
  model: null as unknown as MockLanguageModelV4,
  invoke: vi.fn(),
  dirty: false,
  backgroundDirty: false,
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
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "intelligence_read_file" ? "const old = 1;" : undefined,
  );
  mocks.model = new MockLanguageModelV4({
    doStream: [
      step("read_file", { path: "file.ts" }),
      step("edit_file", { path: "file.ts", oldText: "old", newText: "value" }),
      step(),
    ],
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
  it("reads, obtains approval, applies the exact read version, and continues to an answer", async () => {
    const options = params();
    const permission = vi.fn((event) => {
      expect(mocks.invoke).not.toHaveBeenCalledWith("intelligence_edit_file", expect.anything());
      expect(event.description).toContain("With:\nvalue");
      respondToIntelligencePermission(event.requestId, true);
    });
    expect(await runIntelligenceAgent({ ...options, onPermissionRequest: permission })).toEqual({
      outcome: "completed",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "intelligence_edit_file",
      expect.objectContaining({
        expectedContent: "const old = 1;",
        oldText: "old",
        newText: "value",
      }),
    );
    expect(options.onChunk).toHaveBeenCalledWith("Finished");
    expect(mocks.model.doStreamCalls).toHaveLength(3);
  });
  it("does not write when the user denies an edit", async () => {
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => respondToIntelligencePermission(event.requestId, false),
    });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "intelligence_edit_file")).toBe(
      false,
    );
  });
  it("does not overwrite an unsaved editor buffer after approval", async () => {
    mocks.dirty = true;
    const complete = vi.fn();
    await runIntelligenceAgent({
      ...params(),
      onToolComplete: complete,
      onPermissionRequest: (event) => respondToIntelligencePermission(event.requestId, true),
    });
    expect(complete).toHaveBeenCalledWith(
      "edit_file",
      "edit_file",
      undefined,
      expect.stringContaining("unsaved changes"),
    );
    expect(mocks.invoke.mock.calls.some(([command]) => command === "intelligence_edit_file")).toBe(
      false,
    );
  });
  it("cancels pending approval and leaves the file unchanged", async () => {
    expect(
      await runIntelligenceAgent({
        ...params(),
        onPermissionRequest: () => cancelIntelligenceAgent("test-session"),
      }),
    ).toEqual({ outcome: "cancelled" });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "intelligence_edit_file")).toBe(
      false,
    );
  });
  it("omits mutation tools in plan mode", async () => {
    mocks.model = new MockLanguageModelV4({ doStream: [step()] });
    await runIntelligenceAgent({ ...params(), readOnly: true });
    expect(
      mocks.model.doStreamCalls[0].tools?.some(
        (tool) => tool.type === "function" && ["edit_file", "run_command"].includes(tool.name),
      ),
    ).toBe(false);
  });
  it("protects unsaved files in background workspaces", async () => {
    mocks.backgroundDirty = true;
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => respondToIntelligencePermission(event.requestId, true),
    });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "intelligence_edit_file")).toBe(
      false,
    );
  });
  it("runs a command only after showing it for approval", async () => {
    mocks.model = new MockLanguageModelV4({
      doStream: [step("run_command", { command: "bun test" }), step()],
    });
    await runIntelligenceAgent({
      ...params(),
      onPermissionRequest: (event) => {
        expect(event.description).toContain("bun test");
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: vi.fn(() => ({
      acpStatus: null,
      actions: {
        getChatById: vi.fn(),
        getCurrentChat: vi.fn(),
        setAcpStatus: vi.fn(),
        setAvailableSlashCommands: vi.fn(),
        setChatAcpSessionId: vi.fn(),
        setCurrentModeId: vi.fn(),
        setSessionConfigOptions: vi.fn(),
        setSessionModeState: vi.fn(),
        updateChatTitle: vi.fn(),
      },
    })),
  },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: vi.fn(() => ({
      actions: {
        openTerminalBuffer: vi.fn(),
        openWebViewerBuffer: vi.fn(),
      },
    })),
  },
}));

vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      rootFolderPath: "/workspace",
    })),
  },
}));

function createHandler(
  overrides: Partial<{
    onChunk: (chunk: string) => void;
    onComplete: (result?: AgentCompletionResult) => void;
    onError: (error: string, canReconnect?: boolean) => void;
    onResponseContinuation: () => void;
    onEvent: (event: AcpEvent) => void;
    onPermissionRequest: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  }> = {},
) {
  const handlers = {
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const handler = new AcpStreamHandler("codex", handlers, "chat-1") as unknown as {
    activeSessionId: string | null;
    handleAcpEvent: (event: AcpEvent) => void;
  };

  handler.activeSessionId = "session-a";
  return { handler, handlers };
}

describe("AcpStreamHandler", () => {
  it.each([true, false])("honors the agent image prompt capability (%s)", async (image) => {
    const status = {
      running: true,
      initialized: true,
      sessionActive: true,
      agentId: "codex",
      sessionId: "session-a",
      workspacePath: "/workspace",
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: null,
        authCapabilities: null,
      },
    };
    const original = useAIChatStore.getState();
    vi.mocked(useAIChatStore.getState).mockReturnValue({ ...original, acpStatus: status });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_acp_status" || command === "start_acp_agent") return status;
      return undefined;
    });
    const handlers = { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
    const handler = new AcpStreamHandler("codex", handlers, "chat-1");
    try {
      const start = handler.start("/review", {
        projectRoot: "/workspace",
        images: [{ mediaType: "image/png", data: "YWJj" }],
      });
      await vi.advanceTimersByTimeAsync(1000);
      await start;
      if (image) {
        expect(invoke).toHaveBeenCalledWith("send_acp_prompt", {
          prompt: [
            { type: "text", text: "/review" },
            { type: "image", mimeType: "image/png", data: "YWJj" },
          ],
        });
        expect(handlers.onError).not.toHaveBeenCalled();
      } else {
        expect(
          vi.mocked(invoke).mock.calls.some(([command]) => command === "send_acp_prompt"),
        ).toBe(false);
        expect(handlers.onError).toHaveBeenCalledWith(
          expect.stringContaining("does not support image attachments"),
          undefined,
        );
      }
    } finally {
      await AcpStreamHandler.cancelPrompt();
      vi.mocked(useAIChatStore.getState).mockReturnValue(original);
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(listen).mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("ignores streamed content from a different ACP session", () => {
    const { handler, handlers } = createHandler();

    handler.handleAcpEvent({
      type: "content_chunk",
      sessionId: "session-b",
      isComplete: false,
      content: { type: "text", text: "wrong chat" },
    });

    expect(handlers.onChunk).not.toHaveBeenCalled();

    handler.handleAcpEvent({
      type: "content_chunk",
      sessionId: "session-a",
      isComplete: false,
      content: { type: "text", text: "right chat" },
    });

    expect(handlers.onChunk).toHaveBeenCalledWith("right chat");
  });

  it("accepts permission requests only from the active ACP session", () => {
    const onPermissionRequest = vi.fn();
    const { handler } = createHandler({ onPermissionRequest });
    const permission = {
      type: "permission_request" as const,
      requestId: "permission-1",
      permissionType: "tool_call",
      resource: "tool-1",
      description: "Run command",
      options: [],
    };

    handler.handleAcpEvent({ ...permission, sessionId: "session-b" });
    expect(onPermissionRequest).not.toHaveBeenCalled();

    handler.handleAcpEvent({ ...permission, sessionId: "session-a" });
    expect(onPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "permission-1", sessionId: "session-a" }),
    );
  });

  it("starts a response continuation before reasoning that follows a completed tool", () => {
    const calls: string[] = [];
    const { handler } = createHandler({
      onResponseContinuation: () => calls.push("response-continuation"),
      onEvent: (event) => calls.push(event.type),
    });

    handler.handleAcpEvent({
      type: "tool_start",
      sessionId: "session-a",
      toolName: "read_file",
      toolId: "tool-1",
      input: {},
      kind: "read",
      status: "in_progress",
      locations: [],
    });
    handler.handleAcpEvent({
      type: "tool_complete",
      sessionId: "session-a",
      toolId: "tool-1",
      success: true,
    });
    calls.length = 0;

    handler.handleAcpEvent({
      type: "thought_chunk",
      sessionId: "session-a",
      content: { type: "text", text: "Checking the result" },
      isComplete: false,
    });

    expect(calls).toEqual(["response-continuation", "thought_chunk"]);
  });

  it("normalizes startup authentication errors for the login action", () => {
    const handler = new AcpStreamHandler("gemini-cli", {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }) as unknown as { formatStartupError: (error: unknown) => string };

    expect(
      handler.formatStartupError(
        new Error("gemini-cli requires authentication before it can answer prompts."),
      ),
    ).toBe(
      "Authentication required: gemini-cli must be authenticated before it can answer prompts.",
    );

    expect(
      handler.formatStartupError(
        new Error(
          "Authentication required. Agent stderr: Authentication failed: GOOGLE_CLOUD_PROJECT is required",
        ),
      ),
    ).toBe(
      "Authentication required: gemini-cli must be authenticated before it can answer prompts.|||Authentication failed: GOOGLE_CLOUD_PROJECT is required",
    );
  });

  it("waits for ACP prompt completion instead of completing after inactivity", () => {
    const { handler, handlers } = createHandler();

    handler.handleAcpEvent({
      type: "content_chunk",
      sessionId: "session-a",
      isComplete: false,
      content: { type: "text", text: "still working" },
    });

    vi.advanceTimersByTime(120_000);

    expect(handlers.onComplete).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();

    handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "end_turn",
    });

    expect(handlers.onComplete).toHaveBeenCalledTimes(1);
    expect(handlers.onComplete).toHaveBeenCalledWith({ outcome: "completed" });
  });

  it("reports cancelled prompt completion without treating it as finished work", () => {
    const { handler, handlers } = createHandler();

    handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "cancelled",
    });

    expect(handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
  });

  it("ignores prompt completion from a different ACP session", () => {
    const { handler, handlers } = createHandler();

    handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-b",
      stopReason: "end_turn",
    });

    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("serializes concurrent ACP startup requests", async () => {
    let resolveStart: ((status: unknown) => void) | undefined;
    const startResult = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const runningStatus = {
      running: true,
      initialized: true,
      agentId: "codex",
      sessionId: null,
      workspacePath: "/workspace",
    };

    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_acp_status") {
        const startCalls = vi
          .mocked(invoke)
          .mock.calls.filter(([name]) => name === "start_acp_agent");
        return Promise.resolve(
          startCalls.length > 0
            ? runningStatus
            : {
                ...runningStatus,
                running: false,
                initialized: false,
              },
        );
      }
      if (command === "start_acp_agent") {
        return startResult;
      }
      return Promise.resolve(undefined);
    });

    const first = createHandler().handler as unknown as {
      ensureAgentRunning: () => Promise<void>;
    };
    const second = createHandler().handler as unknown as {
      ensureAgentRunning: () => Promise<void>;
    };

    const firstStartup = first.ensureAgentRunning();
    const secondStartup = second.ensureAgentRunning();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "start_acp_agent"),
    ).toHaveLength(1);

    resolveStart?.(runningStatus);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([firstStartup, secondStartup]);

    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "start_acp_agent"),
    ).toHaveLength(1);
  });

  it("releases the startup queue when agent startup stalls", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_acp_status") {
        return Promise.resolve({
          running: false,
          initialized: false,
          agentId: null,
          sessionId: null,
          workspacePath: null,
        });
      }
      if (command === "start_acp_agent") {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });

    const stalled = createHandler().handler as unknown as {
      ensureAgentRunning: () => Promise<void>;
    };
    const startup = stalled.ensureAgentRunning();
    const startupError = startup.catch((error) => error);

    await vi.advanceTimersByTimeAsync(15_000);
    expect((await startupError).message).toContain("startup timed out");

    const next = createHandler().handler as unknown as {
      ensureAgentRunning: () => Promise<void>;
    };
    const nextStartup = next.ensureAgentRunning();
    const nextStartupError = nextStartup.catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "start_acp_agent"),
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(15_000);
    expect((await nextStartupError).message).toContain("startup timed out");
  });

  it("fails a prompt that produces no ACP activity", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_acp_status") {
        return Promise.resolve({
          running: true,
          initialized: true,
          agentId: "codex",
          sessionId: "session-a",
          workspacePath: "/workspace",
        });
      }
      if (command === "start_acp_agent") {
        return Promise.resolve({
          running: true,
          initialized: true,
          agentId: "codex",
          sessionId: "session-a",
          workspacePath: "/workspace",
        });
      }
      return Promise.resolve(undefined);
    });

    const { handler, handlers } = createHandler();
    const start = (handler as unknown as AcpStreamHandler).start("Hey", {
      agentId: "codex",
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await start;

    expect(handlers.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.stringContaining("did not return any activity"),
      undefined,
    );
  });

  it("invokes ACP session delete and logout commands", async () => {
    await AcpStreamHandler.deleteSession("session-a");
    await AcpStreamHandler.logoutAgent();

    expect(invoke).toHaveBeenCalledWith("delete_acp_session", {
      args: { sessionId: "session-a" },
    });
    expect(invoke).toHaveBeenCalledWith("logout_acp_agent");
  });

  it("stops and eagerly starts a fresh ACP session", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "get_acp_status") {
        return Promise.resolve({
          running: false,
          initialized: false,
          agentId: null,
          sessionId: null,
          workspacePath: null,
        });
      }
      if (command === "start_acp_agent") {
        return Promise.resolve({
          running: true,
          initialized: true,
          agentId: "gemini-cli",
          sessionId: "fresh-session",
          workspacePath: "/workspace",
        });
      }
      return Promise.resolve(undefined);
    });

    const restart = AcpStreamHandler.restartAgent("gemini-cli", "chat-1");
    await vi.advanceTimersByTimeAsync(1000);
    await restart;

    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands.indexOf("stop_acp_agent")).toBeLessThan(commands.indexOf("start_acp_agent"));
    expect(invoke).toHaveBeenCalledWith("start_acp_agent", {
      agentId: "gemini-cli",
      sessionId: null,
      workspacePath: "/workspace",
    });
  });
});

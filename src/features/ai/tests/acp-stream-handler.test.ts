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
    onToolUpdate: (event: Extract<AcpEvent, { type: "tool_update" }>) => void;
    onToolComplete: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
    onResponsePhase: (phase: "starting" | "waiting" | "stalled") => void;
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
    requestCancel: () => void;
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
      // Nothing answers the cancel here; let the grace period end the turn.
      await vi.advanceTimersByTimeAsync(10_000);
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

  it("routes agent questions to the chat, including request-scoped ones", () => {
    const onEvent = vi.fn();
    const { handler } = createHandler({ onEvent });
    const question = {
      type: "elicitation_request" as const,
      requestId: "question-1",
      request: {
        mode: "form" as const,
        message: "Which scope?",
        requestedSchema: { type: "object" as const, properties: {} },
      },
    };

    handler.handleAcpEvent({ ...question, sessionId: "session-b" });
    expect(onEvent).not.toHaveBeenCalled();

    handler.handleAcpEvent({ ...question, sessionId: "session-a" });
    handler.handleAcpEvent({ ...question, requestId: "question-2", sessionId: null });
    expect(onEvent.mock.calls.map(([event]) => event.requestId)).toEqual([
      "question-1",
      "question-2",
    ]);
    expect(invoke).not.toHaveBeenCalledWith("respond_acp_elicitation", expect.anything());
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
    expect(handlers.onComplete).toHaveBeenCalledWith({
      outcome: "completed",
      stopReason: "end_turn",
    });
  });

  it.each(["max_tokens", "max_turn_requests", "refusal"] as const)(
    "passes the %s stop reason to the chat instead of a plain finish",
    (stopReason) => {
      const { handler, handlers } = createHandler();

      handler.handleAcpEvent({ type: "prompt_complete", sessionId: "session-a", stopReason });

      expect(handlers.onComplete).toHaveBeenCalledWith({ outcome: "completed", stopReason });
      expect(handlers.onError).not.toHaveBeenCalled();
    },
  );

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

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect((await startupError).message).toContain("startup timed out");
    expect(invoke).toHaveBeenCalledWith("stop_acp_agent");

    const next = createHandler().handler as unknown as {
      ensureAgentRunning: () => Promise<void>;
    };
    const nextStartup = next.ensureAgentRunning();
    const nextStartupError = nextStartup.catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "start_acp_agent"),
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect((await nextStartupError).message).toContain("startup timed out");
  });

  it("hints that a quiet prompt is still waiting instead of failing it", async () => {
    const status = {
      running: true,
      initialized: true,
      agentId: "codex",
      sessionId: "session-a",
      workspacePath: "/workspace",
    };
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(
        command === "get_acp_status" || command === "start_acp_agent" ? status : undefined,
      ),
    );

    const onResponsePhase = vi.fn();
    const { handler, handlers } = createHandler({ onResponsePhase });
    const start = (handler as unknown as AcpStreamHandler).start("Hey", {
      agentId: "codex",
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await start;

    await vi.advanceTimersByTimeAsync(20_000);
    expect(onResponsePhase).toHaveBeenLastCalledWith("stalled");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onComplete).not.toHaveBeenCalled();

    handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "end_turn",
    });
    expect(handlers.onComplete).toHaveBeenCalledWith({
      outcome: "completed",
      stopReason: "end_turn",
    });
  });

  it("keeps applying tool updates after Stop until the agent ends the turn", () => {
    const onToolUpdate = vi.fn();
    const onToolComplete = vi.fn();
    const { handler, handlers } = createHandler({ onToolUpdate, onToolComplete });
    handler.handleAcpEvent({
      type: "tool_start",
      sessionId: "session-a",
      toolName: "run",
      toolId: "tool-1",
      input: {},
      kind: "execute",
      status: "in_progress",
      locations: [],
    });

    handler.requestCancel();
    handler.handleAcpEvent({
      type: "tool_update",
      sessionId: "session-a",
      toolId: "tool-1",
      status: "failed",
      error: "Interrupted",
    });
    handler.handleAcpEvent({
      type: "tool_complete",
      sessionId: "session-a",
      toolId: "tool-1",
      success: false,
      error: "Interrupted",
    });

    expect(onToolUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(onToolComplete).toHaveBeenCalledWith("run", "tool-1", undefined, "Interrupted");
    expect(handlers.onComplete).not.toHaveBeenCalled();

    handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "cancelled",
    });
    expect(handlers.onComplete).toHaveBeenCalledExactlyOnceWith({ outcome: "cancelled" });

    handler.handleAcpEvent({
      type: "tool_update",
      sessionId: "session-a",
      toolId: "tool-1",
      status: "completed",
    });
    expect(onToolUpdate).toHaveBeenCalledTimes(1);
  });

  it("ends a stopped turn as cancelled whatever the agent answers", () => {
    const stopReason = createHandler();
    stopReason.handler.requestCancel();
    stopReason.handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "end_turn",
    });
    expect(stopReason.handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });

    const failure = createHandler();
    failure.handler.requestCancel();
    failure.handler.handleAcpEvent({
      type: "error",
      sessionId: "session-a",
      error: "Failed to run prompt",
    });
    expect(failure.handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
    expect(failure.handlers.onError).not.toHaveBeenCalled();
  });

  it("finishes a stopped turn when the agent never answers the cancel", async () => {
    const { handler, handlers } = createHandler();
    handler.requestCancel();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(handlers.onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(handlers.onComplete).toHaveBeenCalledExactlyOnceWith({ outcome: "cancelled" });
  });

  it("sends the next prompt once the stopped turn has finished", async () => {
    const status = {
      running: true,
      initialized: true,
      agentId: "codex",
      sessionId: "session-a",
      workspacePath: "/workspace",
    };
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(
        command === "get_acp_status" || command === "start_acp_agent" ? status : undefined,
      ),
    );
    const first = createHandler();
    const firstStart = (first.handler as unknown as AcpStreamHandler).start("First", {
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await firstStart;
    await AcpStreamHandler.cancelPrompt();
    expect(invoke).toHaveBeenCalledWith("cancel_acp_prompt");

    const second = createHandler();
    const secondStart = (second.handler as unknown as AcpStreamHandler).start("Second", {
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(0);
    const prompts = () =>
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "send_acp_prompt");
    expect(prompts()).toHaveLength(1);
    expect(second.handlers.onError).not.toHaveBeenCalled();

    first.handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "cancelled",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await secondStart;
    expect(prompts()).toHaveLength(2);
    expect(first.handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });

    second.handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "end_turn",
    });
  });

  it("stops the startup instead of failing when Stop is pressed while the agent starts", async () => {
    let rejectStart: ((error: Error) => void) | undefined;
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
        return new Promise((_, reject) => {
          rejectStart = reject;
        });
      }
      return Promise.resolve(undefined);
    });

    const onResponsePhase = vi.fn();
    const { handler, handlers } = createHandler({ onResponsePhase });
    const start = (handler as unknown as AcpStreamHandler).start("Hey", {
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResponsePhase).toHaveBeenCalledWith("starting");

    await AcpStreamHandler.cancelPrompt();
    rejectStart?.(new Error("ACP agent startup was stopped"));
    await start;

    expect(handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("install_acp_agent", expect.anything());
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
      mcpServers: [],
    });
  });

  it("signs a running agent in place with the method the user picked", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "get_acp_status"
        ? { running: true, initialized: true, agentId: "gemini", sessionId: "session-a" }
        : undefined,
    );

    await AcpStreamHandler.authenticateAgent("gemini", "chat-1", "oauth-personal");

    expect(invoke).toHaveBeenCalledWith("authenticate_acp_agent", { methodId: "oauth-personal" });
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "start_acp_agent")).toBe(
      false,
    );
  });

  it("starts a stopped agent with the method the user picked", async () => {
    const status = {
      running: true,
      initialized: true,
      agentId: "gemini",
      sessionId: "session-b",
      workspacePath: "/workspace",
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_acp_status") return { running: false, agentId: "" };
      if (command === "start_acp_agent") return status;
      return undefined;
    });

    const signIn = AcpStreamHandler.authenticateAgent("gemini", "chat-1", "gemini-api-key");
    await vi.advanceTimersByTimeAsync(1000);
    await signIn;

    expect(invoke).toHaveBeenCalledWith("start_acp_agent", {
      agentId: "gemini",
      workspacePath: "/workspace",
      sessionId: null,
      authMethodId: "gemini-api-key",
      mcpServers: [],
    });
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "authenticate_acp_agent"),
    ).toBe(false);
  });
});

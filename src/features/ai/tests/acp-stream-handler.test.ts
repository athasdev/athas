import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { AgentCompletionResult } from "@/features/ai/types/agent-completion.types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const { chats } = vi.hoisted(() => ({
  chats: new Map<string, { id: string; agentId: string; acpSessionId: string | null }>(),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: vi.fn(() => ({
      acpAgents: {},
      actions: {
        getChatById: vi.fn((chatId: string) => chats.get(chatId)),
        getCurrentChat: vi.fn(),
        setAcpAgentStatus: vi.fn(),
        setChatAcpSessionId: vi.fn(),
        clearAcpSession: vi.fn(),
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

function agentStatus(overrides: Record<string, unknown> = {}) {
  return {
    running: true,
    initialized: true,
    agentId: "codex",
    workspacePath: "/workspace",
    sessionIds: ["session-a"],
    ...overrides,
  };
}

/** Answers `open_acp_session` for each chat with that chat's session on one shared agent. */
function mockOpenSessions(sessionsByChat: Record<string, string>) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "open_acp_session") {
      const { sessionId } = (args ?? {}) as { sessionId?: string | null };
      const opened = sessionId ?? Object.values(sessionsByChat)[0];
      return { sessionId: opened, status: agentStatus({ sessionIds: [opened] }) };
    }
    return undefined;
  });
}

const sentPrompts = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "send_acp_prompt")
    .map(([, args]) => (args as { sessionId: string }).sessionId);

describe("AcpStreamHandler", () => {
  it.each([true, false])("honors the agent image prompt capability (%s)", async (image) => {
    const status = {
      running: true,
      initialized: true,
      agentId: "codex",
      sessionIds: ["session-a"],
      workspacePath: "/workspace",
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: null,
        authCapabilities: null,
      },
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "open_acp_session") return { sessionId: "session-a", status };
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
          sessionId: "session-a",
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
      await AcpStreamHandler.cancelPrompt("chat-1");
      // Nothing answers the cancel here; let the grace period end the turn.
      await vi.advanceTimersByTimeAsync(10_000);
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(listen).mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    chats.clear();
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

  it("explains an agent that speaks an unsupported protocol version", () => {
    const handler = new AcpStreamHandler("codex", {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }) as unknown as { formatStartupError: (error: unknown) => string };

    expect(
      handler.formatStartupError(
        new Error(
          "codex is currently unavailable: The agent uses ACP protocol version 2, but Athas supports version 1.",
        ),
      ),
    ).toBe("codex uses a protocol version Athas does not support. Update the agent or Athas.");
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

  it("opens a chat's session once at a time but other chats in parallel", async () => {
    const pending: Array<() => void> = [];
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command !== "open_acp_session") return Promise.resolve(undefined);
      const sessionId = (args as { sessionId?: string | null }).sessionId ?? "session-new";
      return new Promise((resolve) => {
        pending.push(() => resolve({ sessionId, status: agentStatus() }));
      });
    });
    chats.set("chat-2", { id: "chat-2", agentId: "codex", acpSessionId: "session-b" });
    const opens = () =>
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "open_acp_session").length;
    const handlerFor = (chatId: string) =>
      new AcpStreamHandler(
        "codex",
        { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
        chatId,
      ) as unknown as { ensureSession: () => Promise<void> };

    const first = handlerFor("chat-1").ensureSession();
    const second = handlerFor("chat-1").ensureSession();
    const otherChat = handlerFor("chat-2").ensureSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(opens()).toBe(2);

    pending.shift()?.();
    pending.shift()?.();
    await Promise.all([first, otherChat]);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens()).toBe(3);
    pending.shift()?.();
    await second;
  });

  it("stops only the stalled startup when opening a session never answers", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "open_acp_session") {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });

    const stalled = createHandler().handler as unknown as {
      ensureSession: () => Promise<void>;
    };
    const startup = stalled.ensureSession();
    const startupError = startup.catch((error) => error);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect((await startupError).message).toContain("startup timed out");
    expect(invoke).toHaveBeenCalledWith("cancel_acp_prompt", {
      sessionId: null,
      agentId: "codex",
      workspacePath: "/workspace",
    });
    expect(invoke).not.toHaveBeenCalledWith("stop_acp_agent", expect.anything());

    const next = createHandler().handler as unknown as {
      ensureSession: () => Promise<void>;
    };
    const nextStartup = next.ensureSession();
    const nextStartupError = nextStartup.catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "open_acp_session"),
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect((await nextStartupError).message).toContain("startup timed out");
  });

  it("hints that a quiet prompt is still waiting instead of failing it", async () => {
    mockOpenSessions({ "chat-1": "session-a" });

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
    mockOpenSessions({ "chat-1": "session-a" });
    const first = createHandler();
    const firstStart = (first.handler as unknown as AcpStreamHandler).start("First", {
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await firstStart;
    await AcpStreamHandler.cancelPrompt("chat-1");
    expect(invoke).toHaveBeenCalledWith("cancel_acp_prompt", {
      sessionId: "session-a",
      agentId: "codex",
      workspacePath: "/workspace",
    });

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
      if (command === "open_acp_session") {
        return new Promise((_, reject) => {
          rejectStart = reject;
        });
      }
      return Promise.resolve(undefined);
    });

    const onResponsePhase = vi.fn();
    const { handler, handlers } = createHandler({ onResponsePhase });
    handler.activeSessionId = null;
    const start = (handler as unknown as AcpStreamHandler).start("Hey", {
      projectRoot: "/workspace",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResponsePhase).toHaveBeenCalledWith("starting");

    await AcpStreamHandler.cancelPrompt("chat-1");
    expect(invoke).toHaveBeenCalledWith("cancel_acp_prompt", {
      sessionId: null,
      agentId: "codex",
      workspacePath: "/workspace",
    });
    rejectStart?.(new Error("ACP agent startup was stopped"));
    await start;

    expect(handlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("install_acp_agent", expect.anything());
  });

  it("invokes ACP session delete, close and logout commands for the agent", async () => {
    await AcpStreamHandler.deleteSession("gemini", "session-a");
    await AcpStreamHandler.closeSession("session-b");
    await AcpStreamHandler.logoutAgent("gemini");

    expect(invoke).toHaveBeenCalledWith("delete_acp_session", {
      args: { agentId: "gemini", workspacePath: "/workspace", sessionId: "session-a" },
    });
    expect(invoke).toHaveBeenCalledWith("close_acp_session", { sessionId: "session-b" });
    expect(invoke).toHaveBeenCalledWith("logout_acp_agent", {
      agentId: "gemini",
      workspacePath: "/workspace",
    });
  });

  it("stops and eagerly starts a fresh ACP session", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "open_acp_session") {
        return Promise.resolve({
          sessionId: "fresh-session",
          status: agentStatus({ agentId: "gemini-cli", sessionIds: ["fresh-session"] }),
        });
      }
      return Promise.resolve(undefined);
    });

    await AcpStreamHandler.restartAgent("gemini-cli", "chat-1");

    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(invoke).toHaveBeenCalledWith("stop_acp_agent", {
      agentId: "gemini-cli",
      workspacePath: "/workspace",
    });
    expect(commands.indexOf("stop_acp_agent")).toBeLessThan(commands.indexOf("open_acp_session"));
    expect(invoke).toHaveBeenCalledWith("open_acp_session", {
      agentId: "gemini-cli",
      sessionId: null,
      workspacePath: "/workspace",
      mcpServers: [],
    });
  });

  it("signs a running agent in place with the method the user picked", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "get_acp_status"
        ? [agentStatus({ agentId: "claude-acp" }), agentStatus({ agentId: "gemini" })]
        : undefined,
    );

    await AcpStreamHandler.authenticateAgent("gemini", "chat-1", "oauth-personal");

    expect(invoke).toHaveBeenCalledWith("authenticate_acp_agent", {
      agentId: "gemini",
      workspacePath: "/workspace",
      methodId: "oauth-personal",
    });
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "open_acp_session")).toBe(
      false,
    );
  });

  it("starts a stopped agent with the method the user picked", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_acp_status") return [agentStatus({ agentId: "claude-acp" })];
      if (command === "open_acp_session") {
        return { sessionId: "session-b", status: agentStatus({ agentId: "gemini" }) };
      }
      return undefined;
    });

    await AcpStreamHandler.authenticateAgent("gemini", "chat-1", "gemini-api-key");

    expect(invoke).toHaveBeenCalledWith("open_acp_session", {
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

  it("runs prompts in two chats on the same agent at once, each in its own session", async () => {
    chats.set("chat-1", { id: "chat-1", agentId: "codex", acpSessionId: "session-a" });
    chats.set("chat-2", { id: "chat-2", agentId: "codex", acpSessionId: "session-b" });
    mockOpenSessions({ "chat-1": "session-a", "chat-2": "session-b" });
    const handlersFor = () => ({ onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() });
    const firstHandlers = handlersFor();
    const secondHandlers = handlersFor();
    const first = new AcpStreamHandler("codex", firstHandlers, "chat-1");
    const second = new AcpStreamHandler("codex", secondHandlers, "chat-2");

    await Promise.all([
      first.start("First", { projectRoot: "/workspace" }),
      second.start("Second", { projectRoot: "/workspace" }),
    ]);

    expect(sentPrompts()).toEqual(["session-a", "session-b"]);
    expect(firstHandlers.onError).not.toHaveBeenCalled();
    expect(secondHandlers.onError).not.toHaveBeenCalled();

    const route = (handler: AcpStreamHandler, event: AcpEvent) =>
      (handler as unknown as { handleAcpEvent: (event: AcpEvent) => void }).handleAcpEvent(event);
    const chunk = (sessionId: string, text: string): AcpEvent => ({
      type: "content_chunk",
      sessionId,
      isComplete: false,
      content: { type: "text", text },
    });
    for (const handler of [first, second]) {
      route(handler, chunk("session-b", "for chat 2"));
      route(handler, chunk("session-a", "for chat 1"));
    }
    expect(firstHandlers.onChunk.mock.calls).toEqual([["for chat 1"]]);
    expect(secondHandlers.onChunk.mock.calls).toEqual([["for chat 2"]]);

    // Stop in one chat cancels only that chat's session.
    await AcpStreamHandler.cancelPrompt("chat-2");
    expect(invoke).toHaveBeenCalledWith("cancel_acp_prompt", {
      sessionId: "session-b",
      agentId: "codex",
      workspacePath: "/workspace",
    });
    const completion = (sessionId: string, stopReason: "end_turn" | "cancelled"): AcpEvent => ({
      type: "prompt_complete",
      sessionId,
      stopReason,
    });
    route(second, completion("session-b", "cancelled"));
    expect(secondHandlers.onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
    expect(firstHandlers.onComplete).not.toHaveBeenCalled();

    route(first, completion("session-a", "end_turn"));
    expect(firstHandlers.onComplete).toHaveBeenCalledWith({
      outcome: "completed",
      stopReason: "end_turn",
    });
  });

  it("refuses a second prompt in a chat whose turn is still running", async () => {
    mockOpenSessions({ "chat-1": "session-a" });
    const running = createHandler();
    await (running.handler as unknown as AcpStreamHandler).start("First", {
      projectRoot: "/workspace",
    });

    const second = createHandler();
    await (second.handler as unknown as AcpStreamHandler).start("Second", {
      projectRoot: "/workspace",
    });

    expect(second.handlers.onError).toHaveBeenCalledWith(
      expect.stringContaining("still answering in this chat"),
    );
    expect(sentPrompts()).toEqual(["session-a"]);
    running.handler.handleAcpEvent({
      type: "prompt_complete",
      sessionId: "session-a",
      stopReason: "end_turn",
    });
  });

  it("lets every chat on an agent that exited reconnect", () => {
    const { handler, handlers } = createHandler();
    (handler as unknown as { wasRunning: boolean }).wasRunning = true;

    handler.handleAcpEvent({
      type: "status_changed",
      status: agentStatus({ agentId: "gemini", running: false, sessionIds: ["session-z"] }),
      error: "ACP agent process exited: signal 9",
    });
    expect(handlers.onError).not.toHaveBeenCalled();

    handler.handleAcpEvent({
      type: "status_changed",
      status: agentStatus({ running: false, initialized: false }),
      error: "ACP agent process exited: signal 9",
    });
    expect(handlers.onError).toHaveBeenCalledWith(
      "Agent disconnected unexpectedly (ACP agent process exited: signal 9). Click retry to restart.",
      true,
    );
  });
});

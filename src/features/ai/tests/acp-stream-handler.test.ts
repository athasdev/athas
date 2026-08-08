import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import type { AcpEvent } from "@/features/ai/types/acp.types";

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
    onComplete: () => void;
    onError: (error: string, canReconnect?: boolean) => void;
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
          sessionId: null,
          workspacePath: "/workspace",
        });
      }
      return Promise.resolve(undefined);
    });

    const { handler, handlers } = createHandler();
    await (handler as unknown as AcpStreamHandler).start("Hey", {
      agentId: "codex",
      projectRoot: "/workspace",
    });

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

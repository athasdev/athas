import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runAcpTerminalAuth } from "@/features/ai/lib/acp-terminal-auth";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { selectAgentAuthRequest, useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import type { AcpAuthMethod } from "@/features/ai/types/acp.types";

vi.mock("@/features/ai/services/acp-stream-handler", () => ({
  AcpStreamHandler: {
    authenticateAgent: vi.fn(),
    reconnectAgent: vi.fn(),
  },
}));

vi.mock("@/features/ai/lib/acp-terminal-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai/lib/acp-terminal-auth")>()),
  runAcpTerminalAuth: vi.fn(),
}));

const agentMethod: AcpAuthMethod = {
  id: "oauth",
  name: "Sign in with Google",
  description: null,
  kind: "agent",
  terminal: null,
};

const terminalMethod: AcpAuthMethod = {
  id: "tui",
  name: "Log in",
  description: "Runs the agent's login",
  kind: "terminal",
  terminal: { label: "Log in", command: "/opt/agent", args: ["--acp", "login"], env: {} },
};

const { actions } = useAcpAuthStore.getState();
const request = () => useAcpAuthStore.getState().request;

function requireSignIn() {
  actions.require({
    agentId: "gemini",
    sessionId: "session-a",
    methods: [agentMethod, terminalMethod],
  });
}

describe("agent sign-in store", () => {
  beforeEach(() => {
    useAcpAuthStore.setState({ request: null });
    vi.mocked(AcpStreamHandler.authenticateAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(AcpStreamHandler.reconnectAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(runAcpTerminalAuth).mockReset();
  });

  it("offers the methods only to chats on the agent that asked", () => {
    requireSignIn();
    expect(request()?.phase).toBe("choosing");
    expect(selectAgentAuthRequest(request(), "gemini")?.methods).toHaveLength(2);
    expect(selectAgentAuthRequest(request(), "claude-acp")).toBeNull();

    actions.require({ agentId: "gemini", sessionId: null, methods: [] });
    expect(selectAgentAuthRequest(request(), "gemini")).toBeNull();
  });

  it("signs in through the agent for agent methods", async () => {
    requireSignIn();
    const signIn = actions.choose("oauth", { chatId: "chat-1" });
    expect(request()?.phase).toBe("signing_in");
    expect(request()?.activeMethodId).toBe("oauth");

    await expect(signIn).resolves.toBe(true);
    expect(AcpStreamHandler.authenticateAgent).toHaveBeenCalledWith("gemini", "chat-1", "oauth");
    expect(runAcpTerminalAuth).not.toHaveBeenCalled();
    expect(request()).toBeNull();
  });

  it("keeps the choice open with the error when signing in fails", async () => {
    vi.mocked(AcpStreamHandler.authenticateAgent).mockRejectedValue(new Error("Denied"));
    requireSignIn();

    await expect(actions.choose("oauth", {})).resolves.toBe(false);
    expect(request()).toMatchObject({ phase: "choosing", activeMethodId: null, error: "Denied" });
  });

  it("runs terminal methods in a terminal and restarts the agent after they succeed", async () => {
    vi.mocked(runAcpTerminalAuth).mockResolvedValue({ exitCode: 0, signal: null });
    requireSignIn();

    const signIn = actions.choose("tui", { chatId: "chat-1", workingDirectory: "/workspace" });
    expect(request()?.phase).toBe("terminal");

    await expect(signIn).resolves.toBe(true);
    expect(runAcpTerminalAuth).toHaveBeenCalledWith(terminalMethod.terminal, {
      workingDirectory: "/workspace",
      signal: expect.any(AbortSignal),
    });
    expect(AcpStreamHandler.authenticateAgent).not.toHaveBeenCalled();
    expect(AcpStreamHandler.reconnectAgent).toHaveBeenCalledWith("gemini", "chat-1");
    expect(request()).toBeNull();
  });

  it("does not restart the agent when the terminal sign-in fails", async () => {
    vi.mocked(runAcpTerminalAuth).mockResolvedValue({ exitCode: 1, signal: null });
    requireSignIn();

    await expect(actions.choose("tui", {})).resolves.toBe(false);
    expect(AcpStreamHandler.reconnectAgent).not.toHaveBeenCalled();
    expect(request()).toMatchObject({
      phase: "choosing",
      error: "The sign-in command exited with code 1.",
    });
  });

  it("lets the user stop waiting on the terminal and pick again", async () => {
    vi.mocked(runAcpTerminalAuth).mockImplementation(
      (_launch, options) =>
        new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(null))),
    );
    requireSignIn();

    const signIn = actions.choose("tui", {});
    expect(request()?.phase).toBe("terminal");
    actions.cancel();

    await expect(signIn).resolves.toBe(false);
    expect(AcpStreamHandler.reconnectAgent).not.toHaveBeenCalled();
    expect(request()).toMatchObject({ phase: "choosing", activeMethodId: null, error: null });
  });

  it("ignores a second pick while one is in progress", async () => {
    let finish: () => void = () => {};
    vi.mocked(AcpStreamHandler.authenticateAgent).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve())),
    );
    requireSignIn();

    const first = actions.choose("oauth", {});
    await expect(actions.choose("tui", {})).resolves.toBe(false);
    expect(runAcpTerminalAuth).not.toHaveBeenCalled();
    finish();
    await expect(first).resolves.toBe(true);
  });
});

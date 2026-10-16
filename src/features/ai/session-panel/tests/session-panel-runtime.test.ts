// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";
import type { ChatSession, Message } from "@/features/ai/types/ai-chat.types";
import type { TerminalEvent } from "@/features/terminal/types/terminal.types";

const mocks = vi.hoisted(() => ({
  reachablePorts: new Set<number>(),
  terminalListeners: new Map<string, (event: TerminalEvent) => void>(),
  navigate: vi.fn(),
  focusPage: vi.fn(),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: create(() => ({
    chats: [] as ChatSession[],
    messagesByChat: {} as Record<string, Message[]>,
  })),
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: vi.fn() }));
vi.mock("@/features/previews/services/detect-local-ports", () => ({
  COMMON_DEV_PORTS: [3000, 5173],
  detectLocalPorts: async (_fetch: unknown, ports: number[]) =>
    ports.filter((port) => mocks.reachablePorts.has(port)),
}));
vi.mock("@/features/terminal/services/terminal-protocol", () => ({
  subscribeToTerminalEvents: (connectionId: string, listener: (event: TerminalEvent) => void) => {
    mocks.terminalListeners.set(connectionId, listener);
    return () => mocks.terminalListeners.delete(connectionId);
  },
}));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { navigate: mocks.navigate, focusPage: mocks.focusPage },
}));

const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
const { useAcpTerminalsStore } = await import("@/features/ai/stores/acp-terminals.store");
const { useHostedBrowserRunsStore } =
  await import("@/features/browser-use/stores/hosted-browser-runs.store");
const { emitAppEvent } = await import("@/utils/app-events");
const { reportSessionCommandOutput } = await import("../services/session-command-output");
const { startSessionPanelRuntime } = await import("../services/session-panel-runtime");
const { getSessionBrowserPageId, getSessionTerminalId, selectSessionPanel, useSessionPanelStore } =
  await import("../stores/session-panel.store");

const { selectDockLayout, useDockLayoutStore } =
  await import("@/features/layout/stores/dock-layout.store");
const { openSessionTool } = await import("../services/session-tools");

const panel = (chatId: string) => selectSessionPanel(useSessionPanelStore.getState(), chatId);
const dockPanes = (chatId: string) =>
  selectDockLayout(useDockLayoutStore.getState(), { kind: "session", id: chatId }).panes;
const attention = (chatId: string) => useSessionPanelStore.getState().attention[chatId] ?? {};

function commandMessage(id: string, output: string, timestamp: Date): Message {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp,
    toolCalls: [
      {
        id: `${id}-call`,
        name: "Bash",
        kind: "execute",
        input: { command: "bun dev" },
        output: [{ type: "content", content: { type: "text", text: output } }],
        status: "completed",
        timestamp,
      },
    ],
  } as Message;
}

let stop: () => void;

beforeEach(() => {
  // After the real time the tool call summary read when it loaded, so new calls count as
  // started in this window whatever day the tests run.
  const now = Date.now() + 60_000;
  vi.useFakeTimers();
  vi.setSystemTime(now);
  localStorage.clear();
  mocks.reachablePorts.clear();
  mocks.terminalListeners.clear();
  mocks.navigate.mockClear();
  mocks.focusPage.mockClear();
  useSessionPanelStore.setState({
    panels: {},
    servers: {},
    liveServers: {},
    attention: {},
  });
  useDockLayoutStore.setState({ layouts: {}, hidden: false, focusRequest: null });
  useAIChatStore.setState({
    chats: [{ id: "chat-1", acpSessionId: "acp-1" } as ChatSession],
    messagesByChat: {},
  });
  useAcpTerminalsStore.setState({ terminals: {} });
  stop = startSessionPanelRuntime();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("session panel runtime", () => {
  it("opens the browser once a dev server the agent started answers", async () => {
    mocks.reachablePorts.add(5173);
    useAcpTerminalsStore.getState().actions.start("term-1", {
      sessionId: "acp-1",
      cwd: null,
      displayOnly: true,
    });
    useAcpTerminalsStore
      .getState()
      .actions.append("term-1", "acp-1", "  ➜  Local:   http://localhost:5173/\n");
    await vi.advanceTimersByTimeAsync(0);

    expect(useSessionPanelStore.getState().servers["chat-1"]).toEqual(["http://localhost:5173/"]);
    expect(panel("chat-1")).toMatchObject({
      browserUrl: "http://localhost:5173/",
      autoOpened: true,
    });
    expect(dockPanes("chat-1")).toEqual(["browser"]);
    expect(mocks.navigate).toHaveBeenCalledWith(
      getSessionBrowserPageId("chat-1"),
      "http://localhost:5173/",
    );
    expect(mocks.focusPage).not.toHaveBeenCalled();
  });

  it("reads servers from command tool calls, ignoring the ones from before it started", async () => {
    mocks.reachablePorts.add(3000).add(4000);
    useAIChatStore.setState({
      messagesByChat: {
        "chat-1": [
          commandMessage(
            "old",
            "ready on http://localhost:4000",
            new Date(Date.now() - 86_400_000),
          ),
          commandMessage("new", "ready on http://localhost:3000", new Date()),
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(400);

    expect(useSessionPanelStore.getState().servers["chat-1"]).toEqual(["http://localhost:3000/"]);
    expect(panel("chat-1").browserUrl).toBe("http://localhost:3000/");
  });

  it("finds a server in Codex command output streamed outside the transcript", async () => {
    mocks.reachablePorts.add(3000);
    reportSessionCommandOutput("chat-1", "  ➜  Local:   http://local");
    reportSessionCommandOutput("chat-1", "host:3000/\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBe("http://localhost:3000/");
  });

  it("finds a server the agent names in its finished reply", async () => {
    mocks.reachablePorts.add(3000);
    useAIChatStore.setState({
      messagesByChat: {
        "chat-1": [
          {
            id: "reply",
            role: "assistant",
            content: "The dev server is up at http://localhost:3000.",
            timestamp: new Date(),
            isStreaming: false,
          } as Message,
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBe("http://localhost:3000/");
  });

  it("finds the port of a dev server that printed no address", async () => {
    const devServer = commandMessage("dev", "", new Date());
    devServer.isStreaming = false;
    devServer.toolCalls![0]!.status = "in_progress";
    devServer.toolCalls![0]!.input = {
      command: "/bin/zsh -lc 'mise exec node@24.19.0 -- ./node_modules/.bin/vp run dev'",
    };
    devServer.toolCalls![0]!.output = undefined;
    useAIChatStore.setState({ messagesByChat: { "chat-1": [devServer] } });
    await vi.advanceTimersByTimeAsync(400);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBeUndefined();

    mocks.reachablePorts.add(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBe("http://localhost:3000/");
  });

  it("does not open for a server that never answers", async () => {
    useAcpTerminalsStore
      .getState()
      .actions.append("term-1", "acp-1", "Local: http://localhost:5173/\n");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(useSessionPanelStore.getState().servers["chat-1"]).toEqual(["http://localhost:5173/"]);
    expect(dockPanes("chat-1")).toEqual([]);
  });

  it("waits while the user types before opening the panel", async () => {
    mocks.reachablePorts.add(5173);
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));

    useAcpTerminalsStore
      .getState()
      .actions.append("term-1", "acp-1", "Local: http://localhost:5173/\n");
    await vi.advanceTimersByTimeAsync(800);
    expect(dockPanes("chat-1")).toEqual([]);

    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dockPanes("chat-1")).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(dockPanes("chat-1")).toEqual(["browser"]);
    expect(document.activeElement).not.toBe(editor);
    editor.remove();
  });

  it("follows the session terminal's output for servers", async () => {
    mocks.reachablePorts.add(8080);
    emitAppEvent("terminal:ready", {
      terminalId: getSessionTerminalId("chat-1"),
      connectionId: "pty-1",
    });
    const listener = mocks.terminalListeners.get("pty-1");
    const encoder = new TextEncoder();
    listener?.({ event: "output", data: encoder.encode("Listening on http://127.0.0") });
    listener?.({ event: "output", data: encoder.encode(".1:8080\r\n") });
    await vi.advanceTimersByTimeAsync(0);

    expect(useSessionPanelStore.getState().servers["chat-1"]).toContain("http://127.0.0.1:8080/");
    expect(dockPanes("chat-1")).toEqual(["browser"]);
  });

  it("marks the Terminal tab when a command in the session terminal fails", () => {
    const terminalId = getSessionTerminalId("chat-1");
    const failure = { status: "failure" as const, exitCode: 1, durationMs: 20, finishedAt: 1 };
    emitAppEvent("terminal:command-finished", { terminalId, command: failure });
    expect(attention("chat-1").terminal).toBe(true);
    expect(dockPanes("chat-1")).toEqual([]);

    openSessionTool("chat-1", "terminal");
    emitAppEvent("terminal:command-finished", { terminalId, command: failure });
    expect(attention("chat-1").terminal).toBeUndefined();

    emitAppEvent("terminal:command-finished", { terminalId: "terminal-other", command: failure });
    expect(attention("other").terminal).toBeUndefined();
  });

  it("drops a live server once it stops answering, so its pill goes", async () => {
    mocks.reachablePorts.add(5173);
    useAcpTerminalsStore
      .getState()
      .actions.append("term-1", "acp-1", "Local: http://localhost:5173/\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBe("http://localhost:5173/");

    mocks.reachablePorts.delete(5173);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useSessionPanelStore.getState().liveServers["chat-1"]).toBeUndefined();
  });

  it("does not mark anything for a failed agent command, which the chat already shows", async () => {
    const failed = commandMessage("fail", "error: tests failed", new Date());
    failed.toolCalls![0]!.status = "failed";
    useAIChatStore.setState({ messagesByChat: { "chat-1": [failed] } });
    await vi.advanceTimersByTimeAsync(400);
    expect(attention("chat-1")).toEqual({});
  });

  it("routes links clicked in a session into Athas", async () => {
    const { openWebLink } = await import("@/utils/external-navigation");
    const session = document.createElement("div");
    session.setAttribute("data-agent-session-chat", "chat-1");
    const link = document.createElement("a");
    session.append(link);
    document.body.append(session);

    await openWebLink("http://localhost:4000/docs", link);
    expect(dockPanes("chat-1")).toEqual(["browser"]);
    expect(panel("chat-1").browserUrl).toBe("http://localhost:4000/docs");
    session.remove();
  });

  it("marks the Browser tab while the agent uses the hosted browser", () => {
    useHostedBrowserRunsStore.getState().actions.start("chat-1", "https://example.com");
    expect(attention("chat-1").browser).toBe(true);
    useHostedBrowserRunsStore.getState().actions.finish("chat-1");
  });
});

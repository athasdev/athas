// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { onAppEvent } from "@/utils/app-events";
import { initializeDebuggerEventBridge } from "../services/debug-adapter-events";
import { useDebuggerStore } from "../stores/debugger.store";
import type { DebugProtocolMessage, DebugSession } from "../types/debugger.types";

const adapter = vi.hoisted(() => ({
  seq: 100,
  requests: [] as Array<{ seq: number; command: string; args: unknown }>,
  responses: [] as Array<{
    requestSeq: number;
    command: string;
    success: boolean;
    body?: unknown;
    message?: string;
  }>,
  replies: {} as Record<string, (args: unknown) => Record<string, unknown> | undefined>,
  handlers: {} as {
    onMessage?: (message: DebugProtocolMessage) => void;
    onOutput?: (output: unknown) => void;
    onSessionEnded?: (event: unknown) => void;
  },
  subscriptions: 0,
}));

vi.mock("../services/debug-adapter-service", () => ({
  sendDebugAdapterRequest: async (sessionId: string, command: string, args?: unknown) => {
    const seq = ++adapter.seq;
    adapter.requests.push({ seq, command, args });
    const reply = adapter.replies[command]?.(args);
    if (reply) {
      setTimeout(() =>
        adapter.handlers.onMessage?.({
          sessionId,
          message: { type: "response", request_seq: seq, command, success: true, ...reply },
        }),
      );
    }
    return seq;
  },
  sendDebugAdapterResponse: async (
    ...[, requestSeq, command, success, body, message]: [
      string,
      number,
      string,
      boolean,
      unknown?,
      string?,
    ]
  ) => {
    adapter.responses.push({ requestSeq, command, success, body, message });
  },
  subscribeDebuggerEvents: async (handlers: typeof adapter.handlers) => {
    adapter.subscriptions++;
    adapter.handlers = handlers;
    return () => {
      adapter.handlers = {};
    };
  },
}));

const session: DebugSession = {
  id: "session-1",
  name: "Launch",
  configId: "node",
  command: "node",
  startedAt: 1,
  status: "running",
};

const store = () => useDebuggerStore.getState();

function send(message: Record<string, unknown>, sessionId = session.id) {
  adapter.handlers.onMessage?.({ sessionId, message });
}

async function settle() {
  for (let index = 0; index < 10; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeAll(async () => {
  await Promise.all([initializeDebuggerEventBridge(), initializeDebuggerEventBridge()]);
  await initializeDebuggerEventBridge();
});

beforeEach(() => {
  adapter.requests = [];
  adapter.responses = [];
  adapter.replies = {};
  localStorage.clear();
  useDebuggerStore.setState({
    breakpoints: [],
    watchExpressions: [],
    adapterMessages: [],
    adapterOutput: [],
    endedSessions: [],
  });
  store().actions.startSession(session);
});

describe("debugger event bridge", () => {
  it("subscribes to adapter events only once", () => {
    expect(adapter.subscriptions).toBe(1);
  });

  it("loads the call stack, scopes and variables when a thread stops", async () => {
    adapter.replies.stackTrace = () => ({
      body: {
        stackFrames: [
          { id: 1, name: "main", source: { path: "/repo/app.ts" }, line: 4, column: 2 },
          { id: 2 },
          { name: "no id" },
        ],
      },
    });
    adapter.replies.scopes = () => ({
      body: {
        scopes: [
          { name: "Locals", variablesReference: 10, expensive: false },
          { name: "Globals", variablesReference: 0 },
          { name: "broken" },
        ],
      },
    });
    adapter.replies.variables = () => ({
      body: {
        variables: [
          { name: "count", value: "3", type: "number", variablesReference: 0 },
          { name: "user", value: "Object", variablesReference: 11 },
          { value: "no name" },
        ],
      },
    });

    send({ type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 7 } });
    await settle();

    expect(store().activeSession?.status).toBe("paused");
    expect(store().stoppedState).toEqual({
      reason: "breakpoint",
      threadId: 7,
      description: undefined,
    });
    expect(adapter.requests.map(({ command, args }) => [command, args])).toEqual([
      ["stackTrace", { threadId: 7, startFrame: 0, levels: 50 }],
      ["scopes", { frameId: 1 }],
      ["variables", { variablesReference: 10 }],
    ]);
    expect(store().stackFrames).toEqual([
      { id: 1, name: "main", sourcePath: "/repo/app.ts", line: 4, column: 2 },
      { id: 2, name: "Frame 2", sourcePath: undefined, line: 0, column: 0 },
    ]);
    expect(store().scopes).toEqual([
      { name: "Locals", variablesReference: 10, expensive: false },
      { name: "Globals", variablesReference: 0, expensive: undefined },
    ]);
    expect(store().variablesByReference[10]).toEqual([
      { name: "count", value: "3", type: "number", variablesReference: 0 },
      { name: "user", value: "Object", type: undefined, variablesReference: 11 },
    ]);
    expect(store().pendingRequests).toEqual({});
  });

  it("asks for threads when a stop has no thread and follows the first one", async () => {
    adapter.replies.threads = () => ({ body: { threads: [{ id: 3 }, { id: "bad" }] } });
    adapter.replies.stackTrace = () => ({ body: { stackFrames: [] } });

    send({ type: "event", event: "stopped", body: {} });
    await settle();

    expect(store().stoppedState?.reason).toBe("stopped");
    expect(store().threads).toEqual([{ id: 3, name: "Thread 3" }]);
    expect(adapter.requests.map(({ command }) => command)).toEqual(["threads", "stackTrace"]);
  });

  it("refreshes threads on thread events without loading a stack while running", async () => {
    adapter.replies.threads = () => ({ body: { threads: [{ id: 1, name: "main" }] } });

    send({ type: "event", event: "thread", body: { reason: "started", threadId: 1 } });
    await settle();

    expect(store().threads).toEqual([{ id: 1, name: "main" }]);
    expect(adapter.requests.map(({ command }) => command)).toEqual(["threads"]);
  });

  it("drops a stack trace that answers after execution continued", async () => {
    let releaseStack: () => void = () => undefined;
    adapter.replies.stackTrace = () => undefined;

    send({ type: "event", event: "stopped", body: { threadId: 1 } });
    await settle();
    const stackRequest = adapter.requests[0];
    releaseStack = () =>
      send({
        type: "response",
        request_seq: stackRequest.seq,
        command: "stackTrace",
        success: true,
        body: { stackFrames: [{ id: 9, name: "stale" }] },
      });

    send({ type: "event", event: "continued", body: { threadId: 1 } });
    releaseStack();
    await settle();

    expect(store().activeSession?.status).toBe("running");
    expect(store().stoppedState).toBeNull();
    expect(store().stackFrames).toEqual([]);
  });

  it("ignores messages from other sessions and malformed payloads", async () => {
    send({ type: "event", event: "stopped", body: { threadId: 1 } }, "old-session");
    adapter.handlers.onMessage?.({ sessionId: session.id, message: null });
    send({ type: "response", request_seq: 999, command: "stackTrace", success: true });
    await settle();

    expect(store().activeSession?.status).toBe("running");
    expect(adapter.requests).toEqual([]);
    expect(store().adapterMessages).toHaveLength(3);
  });

  it("records adapter output, process output and session end", async () => {
    send({ type: "event", event: "output", body: { category: "stderr", output: "boom\n" } });
    send({ type: "event", event: "output", body: { output: "log\n" } });
    send({ type: "event", event: "output", body: { output: "" } });
    adapter.handlers.onOutput?.({ sessionId: session.id, stream: "stdout", data: "raw" });
    send({ type: "event", event: "exited", body: { exitCode: 0 } });
    adapter.handlers.onSessionEnded?.({ sessionId: session.id, reason: "terminated" });
    await settle();

    expect(store().adapterOutput).toEqual([
      { sessionId: session.id, stream: "stderr", data: "boom\n" },
      { sessionId: session.id, stream: "console", data: "log\n" },
      { sessionId: session.id, stream: "stdout", data: "raw" },
    ]);
    expect(store().endedSessions.map((event) => event.reason)).toEqual(["exited", "terminated"]);
  });

  it("stores adapter capabilities from initialize responses", async () => {
    send({
      type: "response",
      request_seq: 1,
      command: "initialize",
      success: true,
      body: { supportsSetVariable: true },
    });
    await settle();

    expect(store().adapterCapabilities).toEqual({ supportsSetVariable: true });
  });
});

describe("breakpoint verification", () => {
  beforeEach(() => {
    store().actions.toggleBreakpoint("/repo/app.ts", 4);
    store().actions.toggleBreakpoint("/repo/app.ts", 9);
  });

  it("applies setBreakpoints results to the matching local breakpoints", async () => {
    const [first, second] = store().breakpoints;
    store().actions.registerAdapterRequest(session.id, 50, {
      command: "setBreakpoints",
      filePath: "/repo/app.ts",
      breakpointIds: [first.id, second.id],
    });

    send({
      type: "response",
      request_seq: 50,
      command: "setBreakpoints",
      success: true,
      body: {
        breakpoints: [
          { id: 1, verified: true },
          { id: 2, verified: false, message: "No code at this line" },
        ],
      },
    });
    await settle();

    expect(
      store().breakpoints.map(({ adapterId, verified, message }) => [adapterId, verified, message]),
    ).toEqual([
      [1, true, undefined],
      [2, false, "No code at this line"],
    ]);
  });

  it("updates breakpoints the adapter changes later by id or by location", async () => {
    const [first, second] = store().breakpoints;
    store().actions.updateBreakpointAdapterState(first.id, { adapterId: 1, verified: false });

    send({ type: "event", event: "breakpoint", body: { breakpoint: { id: 1, verified: true } } });
    send({
      type: "event",
      event: "breakpoint",
      body: {
        breakpoint: {
          verified: false,
          message: "moved",
          line: 10,
          source: { path: "/repo/app.ts" },
        },
      },
    });
    send({
      type: "event",
      event: "breakpoint",
      body: { breakpoint: { id: 99, line: 50, source: { path: "/repo/other.ts" } } },
    });
    await settle();

    expect(store().breakpoints.find((bp) => bp.id === first.id)?.verified).toBe(true);
    expect(store().breakpoints.find((bp) => bp.id === second.id)).toMatchObject({
      verified: false,
      message: "moved",
    });
  });
});

describe("watch expressions", () => {
  it("shows evaluation results and errors for the current frame only", async () => {
    store().actions.setSessionStatus("paused");
    const watch = store().actions.addWatchExpression("  user.name  ")!;
    const other = store().actions.addWatchExpression("count")!;
    store().actions.registerAdapterRequest(session.id, 60, {
      command: "evaluate",
      expressionId: watch.id,
    });
    store().actions.registerAdapterRequest(session.id, 61, {
      command: "evaluate",
      expressionId: other.id,
    });

    send({
      type: "response",
      request_seq: 60,
      command: "evaluate",
      success: true,
      body: { result: "'Ada'", type: "string", variablesReference: 0 },
    });
    send({
      type: "response",
      request_seq: 61,
      command: "evaluate",
      success: false,
      message: "count is not defined",
    });
    await settle();

    expect(watch.expression).toBe("user.name");
    expect(store().watchResults[watch.id]).toMatchObject({ value: "'Ada'", type: "string" });
    expect(store().watchResults[other.id]).toMatchObject({
      value: "",
      error: "count is not defined",
    });
  });

  it("ignores evaluations that finish after the session resumed", async () => {
    const watch = store().actions.addWatchExpression("x")!;
    store().actions.registerAdapterRequest(session.id, 70, {
      command: "evaluate",
      expressionId: watch.id,
    });

    send({ type: "response", request_seq: 70, command: "evaluate", success: true, body: {} });
    await settle();

    expect(store().watchResults).toEqual({});
  });

  it("persists watch expressions and breakpoints across reloads", () => {
    const watch = store().actions.addWatchExpression("a + b")!;
    store().actions.updateWatchExpression(watch.id, " a - b ");
    store().actions.updateWatchExpression(watch.id, "   ");
    expect(store().actions.addWatchExpression("   ")).toBeNull();
    store().actions.toggleBreakpoint("/repo/x.ts", 1);
    const [breakpoint] = store().breakpoints;
    store().actions.setBreakpointEnabled(breakpoint.id, false);
    store().actions.updateBreakpointOptions(breakpoint.id, { condition: "i > 2" });

    useDebuggerStore.setState({ breakpoints: [], watchExpressions: [] });
    store().actions.hydrate();

    expect(store().watchExpressions.map((item) => item.expression)).toEqual(["a - b"]);
    expect(store().breakpoints).toMatchObject([
      { filePath: "/repo/x.ts", line: 1, enabled: false, condition: "i > 2" },
    ]);

    store().actions.removeWatchExpression(watch.id);
    store().actions.removeBreakpoint(breakpoint.id);
    store().actions.hydrate();
    expect(store().watchExpressions).toEqual([]);
    expect(store().breakpoints).toEqual([]);
  });

  it("ignores corrupt persisted debugger data", () => {
    localStorage.setItem("athas-debugger-breakpoints", "{not json");
    localStorage.setItem("athas-debugger-watch-expressions", JSON.stringify({ not: "a list" }));
    localStorage.setItem("athas-debugger-user-configs", "[");

    store().actions.hydrate();

    expect(store().breakpoints).toEqual([]);
    expect(store().watchExpressions).toEqual([]);
    expect(store().userConfigs).toEqual([]);

    localStorage.setItem(
      "athas-debugger-breakpoints",
      JSON.stringify([
        { id: "ok", filePath: "/a", line: 1, enabled: true, createdAt: 1 },
        { id: 2 },
      ]),
    );
    localStorage.setItem("athas-debugger-user-configs", JSON.stringify([{ id: "mine" }]));
    store().actions.hydrate();

    expect(store().breakpoints.map((breakpoint) => breakpoint.id)).toEqual(["ok"]);
    expect(store().userConfigs).toEqual([{ id: "mine" }]);
  });
});

describe("reverse requests from the adapter", () => {
  it("runs runInTerminal requests in a new terminal and acknowledges them", async () => {
    const terminals: unknown[] = [];
    const stop = onAppEvent("terminal:create-with-command", (detail) => terminals.push(detail));

    send({
      type: "request",
      seq: 5,
      command: "runInTerminal",
      arguments: {
        args: ["node", "--inspect", "app.js", 3],
        cwd: "/repo",
        title: "Node Debug",
        env: { NODE_ENV: "development", BAD: 1 },
      },
    });
    await settle();
    stop();

    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      name: "Node Debug",
      workingDirectory: "/repo",
      environment: { NODE_ENV: "development" },
    });
    expect((terminals[0] as { command: string }).command).toContain("app.js");
    expect(adapter.responses).toEqual([
      { requestSeq: 5, command: "runInTerminal", success: true, body: {}, message: undefined },
    ]);
  });

  it("rejects runInTerminal without a command and unsupported requests", async () => {
    send({ type: "request", seq: 6, command: "runInTerminal", arguments: { args: [] } });
    send({ type: "request", seq: 7, command: "startDebugging", arguments: {} });
    send({ type: "request", command: "runInTerminal" });
    await settle();

    expect(adapter.responses).toEqual([
      {
        requestSeq: 6,
        command: "runInTerminal",
        success: false,
        body: undefined,
        message: "The debug adapter did not provide a terminal command",
      },
      {
        requestSeq: 7,
        command: "startDebugging",
        success: false,
        body: undefined,
        message: "Unsupported debug adapter request: startDebugging",
      },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import {
  applyJavaHotCodeReplace,
  disconnectDebugAdapterSession,
  restartDebugAdapterSession,
  setDebugVariable,
  startDebugLaunchSession,
  startJavaDebugLaunchSession,
  subscribeDebuggerEvents,
  syncDebugBreakpoints,
} from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger.store";
import type { DebugBreakpoint, DebugLaunchConfig } from "../types/debugger.types";

type Listener = (event: { payload: unknown }) => void;

const bus = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  lspCommands: [] as Array<[string, unknown[] | undefined]>,
  lsp: vi.fn<(command: string, args?: unknown[]) => unknown>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, listener: Listener) => {
    const listeners = bus.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    bus.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  },
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      executeCommand: async (...[, command, args]: [string, string, unknown[]?]) => {
        bus.lspCommands.push([command, args]);
        return bus.lsp(command, args);
      },
    }),
  },
}));

type AdapterReply = (args: unknown) => Array<Record<string, unknown>> | void;

interface FakeAdapter {
  requests: Array<{ command: string; args: unknown }>;
  stopped: string[];
  replies: Record<string, AdapterReply>;
}

let adapter: FakeAdapter;
let nextSeq = 1;

function emit(event: string, payload: unknown) {
  for (const listener of bus.listeners.get(event) ?? []) listener({ payload });
}

function listenerCount(event: string) {
  return bus.listeners.get(event)?.size ?? 0;
}

function respond(command: string, extra: Record<string, unknown> = {}) {
  return { type: "response", command, success: true, ...extra };
}

const breakpoint = (overrides: Partial<DebugBreakpoint>): DebugBreakpoint => ({
  id: "bp",
  filePath: "/repo/app.ts",
  line: 0,
  enabled: true,
  createdAt: 1,
  ...overrides,
});

const nodeConfig: DebugLaunchConfig = {
  id: "node",
  name: "Launch app",
  runtime: "node",
  request: "launch",
  program: "/repo/app.ts",
  cwd: "/repo",
  adapterCommand: "js-debug",
  adapterArgs: ["--stdio"],
  source: "workspace",
};

beforeEach(() => {
  bus.listeners.clear();
  bus.lspCommands.length = 0;
  bus.lsp.mockReset();
  nextSeq = 1;
  adapter = {
    requests: [],
    stopped: [],
    replies: {
      initialize: () => [
        respond("initialize", {
          body: {
            supportsConfigurationDoneRequest: true,
            exceptionBreakpointFilters: [
              { filter: "uncaught", label: "Uncaught", default: true },
              { filter: "all", label: "All" },
            ],
          },
        }),
      ],
      launch: () => [{ type: "event", event: "initialized" }],
      attach: () => [{ type: "event", event: "initialized" }],
    },
  };
  useDebuggerStore.setState({
    activeSession: null,
    adapterCapabilities: {},
    pendingRequests: {},
    latestRequestSequences: {},
  });
  vi.spyOn(commands, "debugStartSession").mockImplementation(async (launch) => ({
    id: "session-1",
    command: launch.command ?? "",
    args: launch.args ?? [],
    cwd: launch.cwd ?? null,
  }));
  vi.spyOn(commands, "debugStopSession").mockImplementation(async (sessionId) => {
    adapter.stopped.push(sessionId);
    return null;
  });
  vi.spyOn(commands, "debugSendRequest").mockImplementation(async (sessionId, command, args) => {
    adapter.requests.push({ command, args });
    const messages = adapter.replies[command]?.(args) ?? [];
    setTimeout(() => {
      emit("debugger_message", { sessionId: "other-session", message: respond(command) });
      for (const message of messages) emit("debugger_message", { sessionId, message });
    }, 0);
    return nextSeq++;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("debug adapter launch handshake", () => {
  it("initializes, launches, syncs breakpoints, and finishes configuration in order", async () => {
    const session = await startDebugLaunchSession(nodeConfig, [
      breakpoint({ id: "a", line: 4, condition: "x > 1" }),
      breakpoint({ id: "b", line: 9, enabled: false, filePath: "/repo/lib.ts" }),
    ]);

    expect(commands.debugStartSession).toHaveBeenCalledWith({
      command: "js-debug",
      args: ["--stdio"],
      cwd: "/repo",
      env: undefined,
      host: null,
      port: null,
    });
    expect(adapter.requests.map((request) => request.command)).toEqual([
      "initialize",
      "launch",
      "setBreakpoints",
      "setBreakpoints",
      "setExceptionBreakpoints",
      "configurationDone",
    ]);
    expect(adapter.requests[1].args).toEqual({
      name: "Launch app",
      type: "node",
      request: "launch",
      program: "/repo/app.ts",
      cwd: "/repo",
    });
    expect(adapter.requests.slice(2, 4).map((request) => request.args)).toEqual([
      {
        source: { path: "/repo/app.ts" },
        breakpoints: [{ line: 5, condition: "x > 1" }],
      },
      { source: { path: "/repo/lib.ts" }, breakpoints: [] },
    ]);
    expect(adapter.requests[4].args).toEqual({ filters: ["uncaught"] });
    expect(session.id).toBe("session-1");
    expect(session.capabilities?.supportsConfigurationDoneRequest).toBe(true);
    expect(useDebuggerStore.getState().adapterCapabilities).toEqual(session.capabilities);
    expect(listenerCount("debugger_message")).toBe(0);
  });

  it("skips exception breakpoint setup when the adapter offers no filters", async () => {
    adapter.replies.initialize = () => [respond("initialize", { body: {} })];

    await startDebugLaunchSession({ ...nodeConfig, request: "attach" }, []);

    expect(adapter.requests.map((request) => request.command)).toEqual([
      "initialize",
      "attach",
      "configurationDone",
    ]);
  });

  it("requires an adapter command", async () => {
    await expect(
      startDebugLaunchSession({ ...nodeConfig, adapterCommand: undefined }, []),
    ).rejects.toThrow("Debug configuration is missing adapterCommand");
    expect(commands.debugStartSession).not.toHaveBeenCalled();
  });

  it("stops the adapter and surfaces the reason when initialize is rejected", async () => {
    adapter.replies.initialize = () => [
      respond("initialize", { success: false, message: "Unsupported runtime" }),
    ];

    await expect(startDebugLaunchSession(nodeConfig, [])).rejects.toThrow("Unsupported runtime");

    expect(adapter.stopped).toEqual(["session-1"]);
    expect(listenerCount("debugger_message")).toBe(0);
  });

  it("times out when the adapter never answers and cleans up its listeners", async () => {
    vi.useFakeTimers();
    adapter.replies.initialize = () => [];

    const launch = startDebugLaunchSession(nodeConfig, []);
    const outcome = expect(launch).rejects.toThrow("Timed out waiting for the debug adapter");
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;

    expect(adapter.stopped).toEqual(["session-1"]);
    expect(listenerCount("debugger_message")).toBe(0);
  });

  it("does not treat responses from another session as its own", async () => {
    vi.useFakeTimers();
    adapter.replies.initialize = () => [];

    const launch = startDebugLaunchSession(nodeConfig, []);
    const outcome = expect(launch).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.requests.map((request) => request.command)).toEqual(["initialize"]);
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
  });
});

describe("debug adapter requests", () => {
  it("disconnects with the debuggee choice and always stops the session", async () => {
    adapter.replies.disconnect = () => [respond("disconnect")];
    await disconnectDebugAdapterSession("session-1", false);

    expect(adapter.requests).toEqual([
      { command: "disconnect", args: { restart: false, terminateDebuggee: false } },
    ]);
    expect(adapter.stopped).toEqual(["session-1"]);

    adapter.replies.disconnect = () => [respond("disconnect", { success: false })];
    await expect(disconnectDebugAdapterSession("session-1")).rejects.toThrow(
      "Debug adapter rejected disconnect",
    );
    expect(adapter.stopped).toEqual(["session-1", "session-1"]);
  });

  it("gives up on an unresponsive disconnect after two seconds", async () => {
    vi.useFakeTimers();
    const disconnect = disconnectDebugAdapterSession("session-1");
    const outcome = expect(disconnect).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(2_000);
    await outcome;

    expect(adapter.stopped).toEqual(["session-1"]);
  });

  it("restarts through the adapter", async () => {
    adapter.replies.restart = () => [respond("restart")];

    await expect(restartDebugAdapterSession("session-1")).resolves.toBeUndefined();
    expect(adapter.requests.map((request) => request.command)).toEqual(["restart"]);
  });

  it("returns the value the adapter actually stored for a variable", async () => {
    adapter.replies.setVariable = () => [
      respond("setVariable", { body: { value: "42", type: "int", variablesReference: 7 } }),
    ];
    expect(await setDebugVariable("session-1", 3, "count", "0x2a")).toEqual({
      name: "count",
      value: "42",
      type: "int",
      variablesReference: 7,
    });
    expect(adapter.requests[0].args).toEqual({
      variablesReference: 3,
      name: "count",
      value: "0x2a",
    });

    adapter.replies.setVariable = () => [respond("setVariable")];
    expect(await setDebugVariable("session-1", 3, "count", "5")).toEqual({
      name: "count",
      value: "5",
      type: undefined,
      variablesReference: 0,
    });
  });

  it("reports which Java classes were hot-replaced", async () => {
    adapter.replies.redefineClasses = () => [
      respond("redefineClasses", { body: { changedClasses: ["com.example.Main", 3] } }),
    ];
    expect(await applyJavaHotCodeReplace("session-1")).toEqual({
      changedClasses: ["com.example.Main"],
    });

    adapter.replies.redefineClasses = () => [respond("redefineClasses")];
    expect(await applyJavaHotCodeReplace("session-1")).toEqual({ changedClasses: [] });
  });

  it("clears breakpoints in files that no longer have any and tracks each request", async () => {
    await syncDebugBreakpoints("session-1", [breakpoint({ id: "a", line: 1 })], ["/repo/old.ts"]);

    expect(adapter.requests.map((request) => request.args)).toEqual([
      { source: { path: "/repo/old.ts" }, breakpoints: [] },
      { source: { path: "/repo/app.ts" }, breakpoints: [{ line: 2 }] },
    ]);
    const pending = Object.values(useDebuggerStore.getState().pendingRequests);
    expect(pending).toEqual([
      { command: "setBreakpoints", filePath: "/repo/old.ts", breakpointIds: [] },
      { command: "setBreakpoints", filePath: "/repo/app.ts", breakpointIds: ["a"] },
    ]);
  });
});

describe("Java debug sessions", () => {
  const javaConfig: DebugLaunchConfig = {
    id: "java",
    name: "Launch Java",
    runtime: "java",
    type: "java",
    request: "launch",
    adapterConfiguration: { mainClass: "${file}" },
    source: "workspace",
  };

  it("resolves the main class, classpath and Java executable through the language server", async () => {
    bus.lsp.mockImplementation((command) => {
      switch (command) {
        case "vscode.java.resolveMainMethod":
          return [{ mainClass: "com.example.Main", projectName: "demo" }];
        case "vscode.java.resolveClasspath":
          return [["/mods"], ["/classes"]];
        case "vscode.java.resolveJavaExecutable":
          return "/jdk/bin/java";
        case "vscode.java.startDebugSession":
          return "5005";
        default:
          return undefined;
      }
    });

    await startJavaDebugLaunchSession(javaConfig, [], "/repo/src/Main.java");

    expect(commands.debugStartSession).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 5005 }),
    );
    expect(bus.lspCommands[0]).toEqual([
      "vscode.java.resolveMainMethod",
      ["file:///repo/src/Main.java"],
    ]);
    expect(adapter.requests.find((request) => request.command === "launch")?.args).toEqual({
      mainClass: "com.example.Main",
      projectName: "demo",
      modulePaths: ["/mods"],
      classPaths: ["/classes"],
      javaExec: "/jdk/bin/java",
      name: "Launch Java",
      type: "java",
      request: "launch",
    });
  });

  it("keeps explicit Java settings and skips resolution for attach requests", async () => {
    bus.lsp.mockImplementation((command) =>
      command === "vscode.java.startDebugSession" ? 5005 : undefined,
    );

    await startJavaDebugLaunchSession(
      {
        ...javaConfig,
        adapterConfiguration: {
          mainClass: "com.example.App",
          classPaths: ["/cp"],
          javaExec: "/usr/bin/java",
        },
      },
      [],
      "/repo/src/App.java",
    );
    await startJavaDebugLaunchSession(
      { ...javaConfig, request: "attach", adapterConfiguration: { hostName: "localhost" } },
      [],
      "/repo/src/App.java",
    );

    expect(bus.lspCommands.map(([command]) => command)).toEqual([
      "vscode.java.startDebugSession",
      "vscode.java.startDebugSession",
    ]);
  });

  it("fails when no main method or debug port is available", async () => {
    bus.lsp.mockImplementation((command) =>
      command === "vscode.java.resolveMainMethod" ? [] : undefined,
    );
    await expect(startJavaDebugLaunchSession(javaConfig, [], "/repo/A.java")).rejects.toThrow(
      "No Java main method was found in the active file",
    );

    bus.lsp.mockImplementation((command) =>
      command === "vscode.java.startDebugSession" ? 70_000 : undefined,
    );
    await expect(
      startJavaDebugLaunchSession({ ...javaConfig, request: "attach" }, [], "/repo/A.java"),
    ).rejects.toThrow("Java language server did not return a valid debug adapter port");
    expect(commands.debugStartSession).not.toHaveBeenCalled();
  });
});

describe("debugger event subscription", () => {
  it("routes adapter messages, output and session end until unsubscribed", async () => {
    const received: string[] = [];
    const unsubscribe = await subscribeDebuggerEvents({
      onMessage: (payload) => received.push(`message:${payload.sessionId}`),
      onOutput: (payload) => received.push(`output:${payload.sessionId}`),
      onSessionEnded: (payload) => received.push(`ended:${payload.sessionId}`),
    });

    emit("debugger_message", { sessionId: "s", message: {} });
    emit("debugger_output", { sessionId: "s", stream: "stdout", line: "hi" });
    emit("debugger_session_ended", { sessionId: "s" });
    unsubscribe();
    emit("debugger_message", { sessionId: "late", message: {} });

    expect(received).toEqual(["message:s", "output:s", "ended:s"]);
  });
});

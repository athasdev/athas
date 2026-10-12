// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { onAppEvent } from "@/utils/app-events";
import { useTerminalConnection } from "../hooks/use-terminal-connection";
import type { TerminalTheme } from "../hooks/use-terminal-theme";
import {
  createTerminalEventChannel,
  releaseTerminalEventChannel,
  type PendingTerminalEventChannel,
} from "../services/terminal-protocol";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  themeListeners: new Set<() => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));
vi.mock("@/extensions/themes/theme-registry", () => ({
  themeRegistry: {
    onThemeChange: (listener: () => void) => {
      mocks.themeListeners.add(listener);
      return () => mocks.themeListeners.delete(listener);
    },
  },
}));

interface FakeTerminal {
  terminal: Terminal;
  type: (data: string) => void;
  typeBinary: (data: string) => void;
  resize: (rows: number, cols: number) => void;
  setTitle: (title: string) => void;
  osc7: (payload: string) => boolean;
  lines: string[];
  pendingWrites: Array<() => void>;
}

function fakeTerminal(): FakeTerminal {
  const handlers: Record<string, (value: never) => unknown> = {};
  const listen = (name: string) => (callback: (value: never) => unknown) => {
    handlers[name] = callback;
    return { dispose: () => delete handlers[name] };
  };
  const lines: string[] = [];
  const pendingWrites: Array<() => void> = [];
  const terminal = {
    rows: 24,
    cols: 80,
    onData: listen("data"),
    onBinary: listen("binary"),
    onResize: listen("resize"),
    onTitleChange: listen("title"),
    parser: { registerOscHandler: (_code: number, callback: never) => listen("osc7")(callback) },
    write: (_bytes: Uint8Array, callback: () => void) => pendingWrites.push(callback),
    writeln: (line: string) => lines.push(line),
  };
  return {
    terminal: terminal as unknown as Terminal,
    type: (data) => handlers.data?.(data as never),
    typeBinary: (data) => handlers.binary?.(data as never),
    resize: (rows, cols) => {
      terminal.rows = rows;
      terminal.cols = cols;
      handlers.resize?.({ rows, cols } as never);
    },
    setTitle: (title) => handlers.title?.(title as never),
    osc7: (payload) => handlers.osc7?.(payload as never) as boolean,
    lines,
    pendingWrites,
  };
}

type Options = Partial<Parameters<typeof useTerminalConnection>[0]>;

const updateSession = vi.fn();
const onTerminalExit = vi.fn();
const applyTerminalTheme = vi.fn();
const getTerminalTheme = vi.fn(() => ({ background: "#000" }) as TerminalTheme);
let root: Root;
let fake: FakeTerminal;
let events: PendingTerminalEventChannel;

function Harness(props: Options) {
  useTerminalConnection({
    terminal: fake.terminal,
    connectionId: "pty-1",
    sessionId: "session-1",
    isInitialized: true,
    applyTerminalTheme,
    getTerminalTheme,
    onTerminalExit,
    updateSession,
    ...props,
  });
  return null;
}

async function render(props: Options = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}

async function emit(message: unknown) {
  await act(async () => events.channel.onmessage(message as never));
}

async function drain() {
  while (fake.pendingWrites.length > 0) {
    await act(async () => {
      for (const finish of fake.pendingWrites.splice(0)) finish();
    });
  }
}

const invoked = (command: string) =>
  mocks.invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.themeListeners.clear();
  vi.clearAllMocks();
  fake = fakeTerminal();
  events = createTerminalEventChannel();
  events.bind("pty-1");
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  releaseTerminalEventChannel("pty-1");
  vi.useRealTimers();
});

describe("terminal input", () => {
  it("writes typed text and binary input to the local pty", async () => {
    await render();

    await act(async () => fake.type("ls\r"));
    await act(async () => fake.typeBinary("ÿ\u0001"));

    expect(invoked("terminal_write")).toEqual([
      { id: "pty-1", input: { kind: "text", data: "ls\r" } },
      { id: "pty-1", input: { kind: "binary", data: [255, 1] } },
    ]);
  });

  it("writes to the remote terminal for remote sessions", async () => {
    await render({ remoteConnectionId: "ssh-1" });

    await act(async () => fake.type("pwd\r"));

    expect(invoked("remote_terminal_write")).toEqual([
      { id: "pty-1", input: { kind: "text", data: "pwd\r" } },
    ]);
    expect(invoked("terminal_write")).toEqual([]);
  });

  it("runs the initial command once after the shell starts", async () => {
    vi.useFakeTimers();
    await render({ initialCommand: "npm test" });

    await act(async () => vi.advanceTimersByTime(299));
    expect(invoked("terminal_write")).toEqual([]);
    await act(async () => vi.advanceTimersByTime(1));
    await render({ initialCommand: "npm test" });
    await act(async () => vi.advanceTimersByTime(500));

    expect(invoked("terminal_write")).toEqual([
      { id: "pty-1", input: { kind: "text", data: "npm test\n" } },
    ]);
  });

  it("does not rerun the initial command when reattaching to a live shell", async () => {
    vi.useFakeTimers();
    await render({ initialCommand: "npm test", reuseExistingConnection: true });
    await act(async () => vi.advanceTimersByTime(500));
    expect(invoked("terminal_write")).toEqual([]);
  });
});

describe("terminal metadata", () => {
  it("records titles and working directories reported by the shell", async () => {
    await render();
    updateSession.mockClear();

    await act(async () => {
      fake.setTitle("vim notes.md");
      fake.setTitle("\u001b]0;broken");
      expect(fake.osc7("file://host/Users/me/my%20project")).toBe(true);
      fake.osc7("not-a-file-url");
    });

    expect(updateSession.mock.calls).toEqual([
      ["session-1", { title: "vim notes.md" }],
      ["session-1", { title: "" }],
      ["session-1", { currentDirectory: "/Users/me/my project" }],
    ]);
  });

  it("sends size changes once and resends after a failed resize", async () => {
    await render();
    expect(invoked("terminal_resize")).toHaveLength(1);

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "terminal_resize") throw new Error("pty gone");
      return null;
    });
    await act(async () => fake.resize(30, 100));
    await act(async () => fake.resize(30, 100));
    expect(invoked("terminal_resize")).toHaveLength(3);

    mocks.invoke.mockResolvedValue(null);
    await act(async () => fake.resize(30, 100));
    await act(async () => fake.resize(30, 100));
    expect(invoked("terminal_resize")).toHaveLength(4);
    expect(invoked("terminal_resize").slice(-1)[0]).toMatchObject({
      size: { rows: 30, cols: 100 },
    });
  });

  it("reapplies the terminal theme when the app theme changes", async () => {
    await render();
    await act(async () => mocks.themeListeners.forEach((listener) => listener()));
    expect(applyTerminalTheme).toHaveBeenCalledWith({ background: "#000" });
  });
});

describe("terminal output flow", () => {
  it("pauses the pty while output backs up and resumes once it drains", async () => {
    await render();

    await emit(new Uint8Array(600_000).buffer);
    expect(invoked("terminal_set_paused")).toEqual([{ id: "pty-1", paused: true }]);

    await drain();
    expect(invoked("terminal_set_paused")).toEqual([
      { id: "pty-1", paused: true },
      { id: "pty-1", paused: false },
    ]);
  });

  it("resumes a paused remote pty when the view unmounts", async () => {
    await render({ remoteConnectionId: "ssh-1" });
    await emit(new Uint8Array(600_000).buffer);
    expect(invoked("remote_terminal_set_paused")).toEqual([{ id: "pty-1", paused: true }]);

    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));

    expect(invoked("remote_terminal_set_paused").slice(-1)[0]).toEqual({
      id: "pty-1",
      paused: false,
    });
  });

  it("prints backend errors after earlier output is written", async () => {
    await render();
    await emit(new Uint8Array([65]).buffer);
    await emit({ event: "error", message: "read failed" });
    expect(fake.lines).toEqual([]);

    await drain();
    expect(fake.lines).toEqual(["\r\n\u001b[31mError: read failed\u001b[0m"]);
  });
});

describe("process exit", () => {
  async function exitWith(exit: { exitCode: number | null; signal: string | null }) {
    const exits: unknown[] = [];
    const stop = onAppEvent("terminal:process-exit", (payload) => exits.push(payload));
    await emit({ event: "exit", ...exit });
    await emit({ event: "closed" });
    await drain();
    stop();
    return exits;
  }

  it("closes the tab on a clean exit", async () => {
    await render();
    const exits = await exitWith({ exitCode: 0, signal: null });

    expect(exits).toEqual([{ sessionId: "session-1", exitCode: 0, signal: null }]);
    expect(onTerminalExit).toHaveBeenCalledWith("session-1");
    expect(invoked("close_terminal")).toEqual([{ id: "pty-1" }]);
    expect(fake.lines).toEqual([]);
  });

  it("explains a non-zero exit and keeps the tab open", async () => {
    await render();
    await exitWith({ exitCode: 2, signal: null });

    expect(onTerminalExit).not.toHaveBeenCalled();
    expect(fake.lines).toEqual([
      "\r\n\u001b[33mTerminal process exited unexpectedly (exit code 2).\u001b[0m",
      "\u001b[90mOpen a new terminal tab or close this one manually.\u001b[0m",
    ]);
  });

  it("names the signal that killed the process", async () => {
    await render();
    await exitWith({ exitCode: null, signal: "SIGKILL" });
    expect(fake.lines[0]).toContain("signal SIGKILL");
  });

  it("reports an unknown status when the process ends without exit info", async () => {
    await render();
    await emit({ event: "closed" });
    await drain();
    expect(fake.lines[0]).toContain("unknown status");
  });

  it("does not repeat the exit explanation after a backend error", async () => {
    await render();
    await emit({ event: "error", message: "pty crashed" });
    const exits = await exitWith({ exitCode: 0, signal: null });

    expect(exits).toEqual([{ sessionId: "session-1", exitCode: null, signal: null }]);
    expect(onTerminalExit).not.toHaveBeenCalled();
    expect(fake.lines).toEqual([
      "\r\n\u001b[31mError: pty crashed\u001b[0m",
      "\u001b[90mOpen a new terminal tab or close this one manually.\u001b[0m",
    ]);
  });
});

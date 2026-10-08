// @vitest-environment jsdom
import type { TerminalTheme } from "../hooks/use-terminal-theme";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useTerminalConnection } from "../hooks/use-terminal-connection";
import {
  createTerminalEventChannel,
  releaseTerminalEventChannel,
} from "../services/terminal-protocol";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), write: vi.fn(), flush: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));
vi.mock("@/extensions/themes/theme-registry", () => ({
  themeRegistry: { onThemeChange: () => () => {} },
}));
vi.mock("../hooks/use-terminal-write-buffer", () => ({
  useTerminalWriteBuffer: () => ({
    write: mocks.write,
    writeBinary: mocks.write,
    flush: mocks.flush,
  }),
}));

const updateSession = vi.fn();
const exit = vi.fn();
const theme = vi.fn<() => TerminalTheme>();
const applyTheme = vi.fn();
let root: Root;
let container: HTMLDivElement;
let pendingWrites: Array<() => void>;
let writtenBytes: Uint8Array[];
let title: (value: string) => void;
let input: (value: string) => void;
let terminal: Terminal;

function Harness({ connectionId, signal }: { connectionId: string; signal: AbortSignal }) {
  useTerminalConnection({
    terminal,
    connectionId,
    sessionId: "session",
    sessionSignal: signal,
    isInitialized: true,
    applyTerminalTheme: applyTheme,
    getTerminalTheme: theme,
    onTerminalExit: exit,
    updateSession,
  });
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(undefined);
  pendingWrites = [];
  writtenBytes = [];
  const disposable = { dispose: vi.fn() };
  terminal = {
    rows: 24,
    cols: 80,
    onData: (callback: (data: string) => void) => {
      input = callback;
      return disposable;
    },
    onResize: () => disposable,
    onTitleChange: (callback: (value: string) => void) => {
      title = callback;
      return disposable;
    },
    parser: { registerOscHandler: () => disposable },
    write: (bytes: Uint8Array, callback: () => void) => {
      writtenBytes.push(bytes);
      pendingWrites.push(callback);
    },
    writeln: vi.fn(),
  } as unknown as Terminal;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  releaseTerminalEventChannel("old-pty");
  releaseTerminalEventChannel("new-pty");
});

describe("terminal event lifetime", () => {
  it("does not close a replacement tab when an old process finishes draining after reconnect", async () => {
    const old = createTerminalEventChannel();
    old.bind("old-pty");
    await act(async () =>
      root.render(<Harness connectionId="old-pty" signal={new AbortController().signal} />),
    );
    await act(async () => old.channel.onmessage(new Uint8Array([65]).buffer));
    expect(pendingWrites).toHaveLength(1);
    expect(writtenBytes).toEqual([new Uint8Array([65])]);
    await act(async () => {
      old.channel.onmessage({ event: "exit", exitCode: 0, signal: null });
      old.channel.onmessage({ event: "closed" });
    });
    const next = createTerminalEventChannel();
    next.bind("new-pty");
    await act(async () =>
      root.render(<Harness connectionId="new-pty" signal={new AbortController().signal} />),
    );
    await act(async () => pendingWrites.forEach((finish) => finish()));
    expect(mocks.invoke).toHaveBeenCalledWith("close_terminal", { id: "old-pty" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("close_terminal", { id: "new-pty" });
    expect(exit).not.toHaveBeenCalled();
  });

  it("rejects metadata and input from a closed session before React unmounts the view", async () => {
    const events = createTerminalEventChannel();
    events.bind("old-pty");
    const lifetime = new AbortController();
    await act(async () => root.render(<Harness connectionId="old-pty" signal={lifetime.signal} />));
    updateSession.mockClear();
    lifetime.abort();
    await act(async () => {
      title("late title");
      input("dangerous command\n");
    });
    expect(updateSession).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not deliver a clean-exit callback after the session closes while output is pending", async () => {
    const events = createTerminalEventChannel();
    events.bind("old-pty");
    const lifetime = new AbortController();
    await act(async () => root.render(<Harness connectionId="old-pty" signal={lifetime.signal} />));
    await act(async () => events.channel.onmessage(new Uint8Array([65]).buffer));
    await act(async () => {
      events.channel.onmessage({ event: "exit", exitCode: 0, signal: null });
      events.channel.onmessage({ event: "closed" });
    });
    lifetime.abort();
    await act(async () => pendingWrites.forEach((finish) => finish()));
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("close_terminal", { id: "old-pty" });
  });
});

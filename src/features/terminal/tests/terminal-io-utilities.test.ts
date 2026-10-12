// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { commands } from "@/bindings/commands";
import { useTerminalWriteBuffer } from "../hooks/use-terminal-write-buffer";
import { TerminalLinkTooltip } from "../lib/terminal-link-tooltip";
import { useTerminalShellsStore } from "../stores/shells.store";
import type { Terminal, TerminalInput } from "../types/terminal.types";
import { getTerminalDisplayName } from "../utils/terminal-display-name";

interface HookHandle<T> {
  result: { current: T };
  unmount: () => void;
}

function renderHook<T>(useHook: () => T): HookHandle<T> {
  const result = {} as { current: T };
  function Probe() {
    result.current = useHook();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("terminal write buffer", () => {
  function setup(connectionId: string | null = "pty-1") {
    const writes: Array<[string, TerminalInput]> = [];
    const pending: Array<ReturnType<typeof deferred>> = [];
    const connection = { id: connectionId };
    const writeChunk = vi.fn((id: string, input: TerminalInput) => {
      writes.push([id, structuredClone(input)]);
      const next = deferred();
      pending.push(next);
      return next.promise;
    });
    const hook = renderHook(() =>
      useTerminalWriteBuffer({ getConnectionId: () => connection.id, writeChunk }),
    );
    return { hook, writes, pending, connection, writeChunk };
  }

  it("merges text typed while a write is in flight and keeps order", async () => {
    const { hook, writes, pending } = setup();

    act(() => hook.result.current.write("l"));
    act(() => {
      hook.result.current.write("s");
      hook.result.current.write(" -la");
      hook.result.current.writeBinary([3]);
      hook.result.current.write("\r");
    });

    expect(writes).toEqual([["pty-1", { kind: "text", data: "l" }]]);
    await act(async () => pending[0].resolve());
    await act(async () => pending[1].resolve());
    await act(async () => pending[2].resolve());
    await act(async () => pending[3]?.resolve());

    expect(writes.map(([, input]) => input)).toEqual([
      { kind: "text", data: "l" },
      { kind: "text", data: "s -la" },
      { kind: "binary", data: [3] },
      { kind: "text", data: "\r" },
    ]);
  });

  it("ignores empty input", () => {
    const { hook, writeChunk } = setup();
    act(() => {
      hook.result.current.write("");
      hook.result.current.writeBinary([]);
    });
    expect(writeChunk).not.toHaveBeenCalled();
  });

  it("holds input until a connection exists, then flushes it", async () => {
    const { hook, writes, pending, connection } = setup(null);

    await act(async () => hook.result.current.write("echo hi\r"));
    expect(writes).toEqual([]);

    connection.id = "pty-2";
    const flushed = hook.result.current.flush();
    await act(async () => pending[0].resolve());
    await flushed;

    expect(writes).toEqual([["pty-2", { kind: "text", data: "echo hi\r" }]]);
  });

  it("keeps a failed chunk queued and retries it on the next flush", async () => {
    const { hook, writes, pending } = setup();

    act(() => hook.result.current.write("a"));
    await act(async () => pending[0].reject(new Error("pty busy")));
    expect(writes).toHaveLength(1);

    const retry = hook.result.current.flush();
    await act(async () => pending[1].resolve());
    await retry;

    expect(writes.map(([, input]) => input)).toEqual([
      { kind: "text", data: "a" },
      { kind: "text", data: "a" },
    ]);
  });

  it("shares one flush between concurrent callers and flushes on unmount", async () => {
    const { hook, pending, writes } = setup();
    act(() => hook.result.current.write("x"));
    const first = hook.result.current.flush();
    expect(hook.result.current.flush()).toBe(first);
    await act(async () => pending[0].resolve());
    await first;

    act(() => hook.result.current.writeBinary([1, 2]));
    hook.unmount();
    await act(async () => pending[1].resolve());
    expect(writes.slice(-1)[0]).toEqual(["pty-1", { kind: "binary", data: [1, 2] }]);
  });
});

describe("terminal display name", () => {
  const terminal = (overrides: Partial<Terminal> = {}): Terminal => ({
    id: "t1",
    name: "Terminal 1",
    currentDirectory: "/home/me/project/",
    isPinned: false,
    createdAt: new Date(0),
    ...overrides,
  });

  it("prefers a name the user chose", () => {
    expect(
      getTerminalDisplayName(terminal({ name: "server", customName: true }), { title: "vim" }),
    ).toBe("server");
  });

  it("uses a short, plain shell title", () => {
    expect(getTerminalDisplayName(terminal(), { title: "vim" })).toBe("vim");
  });

  it("falls back from noisy titles to the command, then the directory, then the name", () => {
    const noisy = [
      "me@host: ~/project",
      "Default Terminal",
      "a title that is definitely far too long",
      "C:\\Windows",
      "\u001b]0;bad",
    ];
    for (const title of noisy) {
      expect(
        getTerminalDisplayName(terminal({ initialCommand: "/usr/bin/npm run dev" }), { title }),
      ).toBe("npm");
    }

    expect(getTerminalDisplayName(terminal(), { currentDirectory: "C:\\code\\api\\" })).toBe("api");
    expect(getTerminalDisplayName(terminal())).toBe("project");
    expect(
      getTerminalDisplayName(terminal({ currentDirectory: "", customName: true, name: " " })),
    ).toBe(" ");
    expect(getTerminalDisplayName(terminal({ currentDirectory: "" }))).toBe("Terminal 1");
  });
});

describe("terminal shells store", () => {
  it("loads shells once and retries after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const shells = [{ id: "zsh", name: "zsh", exec_win: null, exec_unix: "/bin/zsh" }];
    const listShells = vi
      .spyOn(commands, "listShells")
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(shells as never);
    const { loadShells } = useTerminalShellsStore.getState().actions;

    await loadShells();
    expect(useTerminalShellsStore.getState()).toMatchObject({ shells: [], hasLoaded: false });

    const loading = loadShells();
    await loadShells();
    await loading;
    await loadShells();

    expect(useTerminalShellsStore.getState()).toMatchObject({
      shells,
      isLoading: false,
      hasLoaded: true,
    });
    expect(listShells).toHaveBeenCalledTimes(2);
  });
});

describe("terminal link tooltip", () => {
  function host(width = 300) {
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { value: width });
    element.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    document.body.appendChild(element);
    return element;
  }

  it("shows the link and hint next to the pointer and hides it", () => {
    const element = host();
    const tooltip = new TerminalLinkTooltip({ element } as unknown as XtermTerminal);

    tooltip.show(
      new MouseEvent("mousemove", { clientX: 150, clientY: 80 }),
      "src/a.ts",
      "Cmd+click",
    );

    const shown = element.querySelector<HTMLElement>("[role=tooltip]")!;
    expect(shown.hidden).toBe(false);
    expect(shown.textContent).toBe("src/a.tsCmd+click");
    expect(shown.style.left).toBe("62px");
    expect(shown.style.top).toBe("42px");

    tooltip.show(new MouseEvent("mousemove", { clientX: 160, clientY: 90 }), "b.ts", "open");
    expect(element.querySelectorAll("[role=tooltip]")).toHaveLength(1);
    expect(shown.textContent).toBe("b.tsopen");

    tooltip.hide();
    expect(shown.hidden).toBe(true);
    tooltip.dispose();
    expect(element.querySelector("[role=tooltip]")).toBeNull();
    tooltip.hide();
  });

  it("keeps the tooltip inside the terminal's right edge", () => {
    const element = host(100);
    const tooltip = new TerminalLinkTooltip({ element } as unknown as XtermTerminal);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);

    tooltip.show(new MouseEvent("mousemove", { clientX: 180, clientY: 60 }), "x", "y");

    expect(element.querySelector<HTMLElement>("[role=tooltip]")!.style.left).toBe("8px");
  });

  it("moves to a new host element and does nothing without one", () => {
    const first = host();
    const terminal = { element: first } as { element: HTMLElement | undefined };
    const tooltip = new TerminalLinkTooltip(terminal as XtermTerminal);
    tooltip.show(new MouseEvent("mousemove"), "a", "b");

    const second = host();
    terminal.element = second;
    tooltip.show(new MouseEvent("mousemove"), "a", "b");
    expect(first.querySelector("[role=tooltip]")).toBeNull();
    expect(second.querySelector("[role=tooltip]")).not.toBeNull();

    terminal.element = undefined;
    tooltip.show(new MouseEvent("mousemove"), "c", "d");
    expect(second.querySelector("[role=tooltip]")!.textContent).toBe("ab");
  });
});

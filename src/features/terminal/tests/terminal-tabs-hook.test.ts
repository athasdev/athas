// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useSessionStore } from "@/features/workspace/stores/session.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useTerminalTabs } from "../hooks/use-terminal-tabs";
import { useTerminalTabsStore } from "../stores/terminal-tabs.store";

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

const names = (result: { current: ReturnType<typeof useTerminalTabs> }) =>
  result.current.terminals.map((terminal) => terminal.name);

function setup() {
  const hook = renderHook(() => useTerminalTabs());
  const create = (name: string, currentDirectory = "/ws", extra = {}) => {
    let id = "";
    act(() => {
      id = hook.result.current.createTerminal({ name, currentDirectory, ...extra });
    });
    return id;
  };
  return { ...hook, create };
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  window.localStorage.clear();
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  workspaceRuntimeRegistry.resetForTests();
});

describe("useTerminalTabs", () => {
  it("creates terminals with unique names and activates the newest", () => {
    const { result, create } = setup();

    const first = create("zsh");
    const second = create("zsh");
    const third = create("zsh");

    expect(names(result)).toEqual(["zsh", "zsh (1)", "zsh (2)"]);
    expect(result.current.activeTerminalId).toBe(third);
    expect(first).toMatch(/^terminal_zsh_/);
    expect(second).not.toBe(first);
  });

  it("derives the remote connection from a remote working directory", () => {
    const { result, create } = setup();

    create("remote", "remote://box-1/home/me");
    create("local", "/ws", { remoteConnectionId: "explicit" });

    expect(result.current.terminals.map((terminal) => terminal.remoteConnectionId)).toEqual([
      "box-1",
      "explicit",
    ]);
  });

  it("cycles between terminals in both directions", () => {
    const { result, create } = setup();
    const a = create("a");
    const b = create("b");
    const c = create("c");

    act(() => result.current.setActiveTerminal(a));
    act(() => result.current.switchToNextTerminal());
    expect(result.current.activeTerminalId).toBe(b);
    act(() => result.current.switchToPrevTerminal());
    act(() => result.current.switchToPrevTerminal());
    expect(result.current.activeTerminalId).toBe(c);
    act(() => result.current.switchToNextTerminal());
    expect(result.current.activeTerminalId).toBe(a);
  });

  it("does not cycle with a single terminal", () => {
    const { result, create } = setup();
    const only = create("only");

    act(() => result.current.switchToNextTerminal());
    act(() => result.current.switchToPrevTerminal());

    expect(result.current.activeTerminalId).toBe(only);
  });

  it("renames, pins, reorders and closes terminals", () => {
    const { result, create } = setup();
    const a = create("a");
    const b = create("b");
    create("c");

    act(() => result.current.updateTerminalName(a, "server"));
    act(() => result.current.pinTerminal(b, true));
    act(() => result.current.reorderTerminals(0, 2));

    expect(names(result)).toEqual(["b", "c", "server"]);
    expect(result.current.terminals[0]).toMatchObject({ isPinned: true });
    expect(result.current.terminals[2]).toMatchObject({ customName: true });

    act(() => result.current.closeTerminal(b));
    act(() => result.current.closeTerminal("missing"));
    expect(names(result)).toEqual(["c", "server"]);
  });

  it("splits, resizes, evens out and unsplits terminal layouts", () => {
    const { result, create } = setup();
    const a = create("a");
    const b = create("b");

    act(() => result.current.splitTerminal(a, "missing", "right"));
    expect(result.current.layouts).toEqual([]);

    act(() => result.current.splitTerminal(a, b, "right"));
    expect(result.current.activeTerminalId).toBe(b);
    const split = result.current.layouts[0];
    expect(split).toMatchObject({ type: "split" });
    const splitId = split.id;

    act(() => result.current.resizeTerminalSplit(splitId, 0, [70, 30]));
    expect(result.current.layouts[0]).toMatchObject({ sizes: [70, 30] });

    act(() => result.current.distributeTerminalSplit(splitId));
    expect(result.current.layouts[0]).toMatchObject({ sizes: [50, 50] });

    const before = result.current.layouts;
    act(() => result.current.resizeTerminalSplit("unknown", 0, [10, 90]));
    act(() => result.current.distributeTerminalSplit("unknown"));
    expect(result.current.layouts).toBe(before);

    act(() => result.current.unsplitTerminal(b));
    expect(result.current.layouts).toEqual([]);
    act(() => result.current.unsplitTerminal(b));
    expect(result.current.layouts).toEqual([]);
  });

  it("saves terminals to the project's session once tabs exist", () => {
    useProjectStore.setState({ rootFolderPath: "/ws" });
    const { create } = setup();

    create("build", "/ws/app");

    const session = useSessionStore.getState().actions.getSession("/ws");
    expect(session?.terminals).toEqual([
      expect.objectContaining({ name: "build", currentDirectory: "/ws/app" }),
    ]);
  });

  it("restores saved terminals and activates the first one", () => {
    act(() =>
      useTerminalTabsStore.getState().actions.dispatch({
        type: "RESTORE_TERMINALS",
        payload: {
          terminals: [
            { id: "t1", name: "one", currentDirectory: "/ws", isPinned: true },
            { id: "t2", name: "two", currentDirectory: "/ws", isPinned: false, customName: true },
          ],
          layouts: [],
        },
      } as never),
    );
    const { result } = setup();

    expect(names(result)).toEqual(["one", "two"]);
    expect(result.current.activeTerminalId).toBe("t1");
    expect(result.current.terminals[1]).toMatchObject({ customName: true });
  });
});

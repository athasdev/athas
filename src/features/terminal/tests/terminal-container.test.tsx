// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { emitAppEvent } from "@/utils/app-events";
import { generateTerminalId, useTerminalTabsStore } from "../stores/terminal-tabs.store";
import { useTerminalStore } from "../stores/terminal.store";
import type { Terminal, TerminalSessionHandle } from "../types/terminal.types";

const io = vi.hoisted(() => {
  const state = {
    invoked: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    handles: [] as string[],
    notified: [] as Array<{ terminalId: string; isTerminalVisible: boolean }>,
    activate: null as null | ((terminalId: string) => void),
  };
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        state.invoked.push({ cmd, args });
        return Promise.resolve(cmd.includes("get_all") || cmd === "list_shells" ? [] : null);
      },
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return state;
});

vi.mock("../components/terminal-session", () => ({
  default: ({
    terminal,
    isActive,
    onRegisterRef,
  }: {
    terminal: Terminal;
    isActive: boolean;
    onRegisterRef?: (terminalId: string, ref: TerminalSessionHandle | null) => void;
  }) => {
    useEffect(() => {
      const record = (method: string) => () => {
        io.handles.push(`${terminal.name}:${method}`);
      };
      onRegisterRef?.(terminal.id, {
        focus: record("focus"),
        showSearch: record("search"),
        navigateCommand: (direction) => io.handles.push(`${terminal.name}:navigate-${direction}`),
        clear: record("clear"),
        selectAll: record("select-all"),
        copyLastCommandOutput: record("copy-output"),
      });
      return () => onRegisterRef?.(terminal.id, null);
    }, [onRegisterRef, terminal.id, terminal.name]);
    return <div data-testid="session" data-active={isActive} data-name={terminal.name} />;
  },
}));
vi.mock("@/features/terminal/services/terminal-command-notifications", () => ({
  notifyTerminalCommandFinished: async (
    detail: { terminalId: string; isTerminalVisible: boolean },
    activate: (terminalId: string) => void,
  ) => {
    io.notified.push({
      terminalId: detail.terminalId,
      isTerminalVisible: detail.isTerminalVisible,
    });
    io.activate = activate;
  },
}));

const { default: TerminalContainer } = await import("../components/terminal-container");

enableMapSet();

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;

async function wait(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 3; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(currentDirectory = "/repo/app") {
  await act(async () =>
    root.render(<TerminalContainer currentDirectory={currentDirectory} isFullScreen={false} />),
  );
  await wait();
}

async function emit(...args: Parameters<typeof emitAppEvent>) {
  await act(async () => emitAppEvent(...args));
  await wait();
}

async function showPane(visible = true) {
  await act(async () => {
    useUIState.getState().setBottomPaneActiveTab("terminal");
    useUIState.getState().setIsBottomPaneVisible(visible);
  });
  await wait();
}

const tabs = () => useTerminalTabsStore.getState().terminals;
const names = () => tabs().map((terminal) => terminal.name);
const activeName = () =>
  tabs().find((terminal) => terminal.id === useTerminalTabsStore.getState().activeTerminalId)?.name;
const tab = (name: string) =>
  within(container)
    .getAllByRole("tab")
    .find((element) => element.getAttribute("aria-label")?.startsWith(name))!;
const isPaneVisible = () => useUIState.getState().isBottomPaneVisible;

async function menu(name: string, label: string) {
  await act(async () => {
    fireEvent.contextMenu(tab(name), { clientX: 10, clientY: 10 });
  });
  await wait();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`No menu item ${label}`);
  await act(async () => item.click());
  await wait(40);
}

function createTerminal(
  name: string,
  extra: { shell?: string; customName?: boolean } = {},
): string {
  const id = generateTerminalId(name);
  useTerminalTabsStore.getState().actions.dispatch({
    type: "CREATE_TERMINAL",
    payload: { id, name, currentDirectory: `/repo/${name}`, ...extra },
  });
  return id;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.invoked = [];
  io.handles = [];
  io.notified = [];
  io.activate = null;
  useUIState.setState({ isBottomPaneVisible: false, bottomPaneActiveTab: "terminal" });
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, terminalCommandNotifications: false },
  }));
  vi.unstubAllGlobals();
});

describe("terminal container", () => {
  it("opens a terminal named after the project folder when the pane first shows", async () => {
    await render();
    expect(tabs()).toHaveLength(0);
    await showPane();
    expect(names()).toEqual(["app"]);
    expect(tabs()[0].currentDirectory).toBe("/repo/app");
    await wait(200);
    expect(io.handles).toContain("app:focus");
    expect(io.invoked.some((call) => call.cmd === "list_shells")).toBe(true);

    io.handles = [];
    await act(async () => useUIState.getState().requestTerminalFocus());
    expect(io.handles).toEqual(["app:focus"]);
  });

  it("creates, switches and activates terminals from app events", async () => {
    createTerminal("one");
    await render("/repo/");
    await showPane();
    await emit("terminal:new");
    expect(names()).toEqual(["one", "repo"]);
    expect(activeName()).toBe("repo");

    await emit("terminal:switch-tab", "prev");
    expect(activeName()).toBe("one");
    await emit("terminal:switch-tab", "next");
    expect(activeName()).toBe("repo");
    await emit("terminal:activate-tab", 0);
    expect(activeName()).toBe("one");
    await emit("terminal:activate-tab", 9);
    expect(activeName()).toBe("one");

    await act(async () => tab("repo").click());
    expect(activeName()).toBe("repo");
  });

  it("closes the active terminal and hides the pane after the last one", async () => {
    const first = createTerminal("one");
    useTerminalStore.getState().actions.registerSession(first, { connectionId: "pty-1" });
    await render();
    await showPane();
    await emit("terminal:close-active");
    expect(tabs()).toHaveLength(0);
    expect(useTerminalStore.getState().sessions.has(first)).toBe(false);
    expect(io.invoked).toContainEqual({ cmd: "close_terminal", args: { id: "pty-1" } });
    expect(isPaneVisible()).toBe(false);
  });

  it("closes other, all and right-hand terminals but keeps pinned ones", async () => {
    createTerminal("one");
    createTerminal("two");
    createTerminal("three");
    createTerminal("four");
    await render();
    await showPane();

    await menu("one", "Pin Terminal");
    expect(tabs().find((terminal) => terminal.name === "one")?.isPinned).toBe(true);
    await menu("three", "Close Terminals to Right");
    expect(names()).toEqual(["one", "two", "three"]);
    await menu("two", "Close Other Terminals");
    expect(names()).toEqual(["one", "two"]);
    await menu("two", "Close All Terminals");
    expect(names()).toEqual(["one"]);
    await menu("one", "Unpin Terminal");
    await menu("one", "Close Terminal");
    expect(tabs()).toHaveLength(0);
  });

  it("renames and duplicates terminals", async () => {
    createTerminal("one", { shell: "zsh" });
    await render();
    await showPane();
    await menu("one", "Rename Terminal");
    const input = within(container).getByRole("textbox", { name: "Rename one" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "  server  " } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(names()).toEqual(["server"]);

    await menu("server", "Duplicate Terminal");
    expect(names()).toEqual(["server", "one"]);
    expect(tabs()[1]).toMatchObject({ currentDirectory: "/repo/one", shell: "zsh" });
  });

  it("splits the active terminal, moves focus between panes and unsplits", async () => {
    createTerminal("one");
    await render();
    await showPane();
    await emit("terminal:split", "down");
    expect(names()).toEqual(["one", "one (1)"]);
    expect(within(container).getAllByTestId("session")).toHaveLength(2);
    const [first, second] = tabs().map((terminal) => terminal.id);
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe(second);

    await emit("terminal:focus-pane", "previous");
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe(first);
    await emit("terminal:focus-pane", "next");
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe(second);

    await emit("terminal:unsplit");
    expect(within(container).getAllByTestId("session")).toHaveLength(1);

    await menu("one", "Split Right");
    expect(tabs()).toHaveLength(3);
  });

  it("runs a requested command once its shell is ready", async () => {
    await render();
    await emit("terminal:create-with-command", {
      command: "/usr/local/bin/claude login",
      environment: { TERM: "xterm" },
    });
    expect(isPaneVisible()).toBe(true);
    expect(names()).toEqual(["claude"]);
    const terminalId = tabs()[0].id;

    await emit("terminal:ready", { terminalId: "unknown", connectionId: "pty-x" });
    await emit("terminal:ready", { terminalId, connectionId: "pty-9" });
    await wait(350);
    expect(io.invoked.filter((call) => call.cmd === "terminal_write")).toEqual([
      {
        cmd: "terminal_write",
        args: { id: "pty-9", input: { kind: "text", data: "/usr/local/bin/claude login\n" } },
      },
    ]);
    expect(io.handles).toContain("claude:focus");

    await emit("terminal:create-with-command", {
      command: "ls",
      name: "remote list",
      workingDirectory: "/srv",
    });
    const remote = tabs().find((terminal) => terminal.name === "remote list")!;
    expect(remote.currentDirectory).toBe("/srv");
    await emit("terminal:ready", {
      terminalId: remote.id,
      connectionId: "ssh-1",
      remoteConnectionId: "host",
    });
    await wait(350);
    expect(io.invoked.some((call) => call.cmd === "remote_terminal_write")).toBe(true);
  });

  it("forwards search, history and selection requests to the active session", async () => {
    createTerminal("one");
    await render();
    await showPane();
    await emit("terminal:open-search");
    await emit("terminal:navigate-command", "previous");
    await emit("terminal:clear");
    await emit("terminal:select-all");
    await emit("terminal:copy-last-command-output");
    await act(async () =>
      within(container).getByRole("button", { name: "Find in terminal" }).click(),
    );
    expect(io.handles).toEqual([
      "one:search",
      "one:navigate-previous",
      "one:clear",
      "one:select-all",
      "one:copy-output",
      "one:search",
    ]);

    io.handles = [];
    await emit("terminal:ensure-session");
    expect(io.handles).toEqual(["one:focus"]);
  });

  it("starts a session on request when none exists", async () => {
    await render("/work/site");
    await emit("terminal:ensure-session");
    expect(names()).toEqual(["site"]);
  });

  it("remembers a command that finished out of view and offers to show it", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, terminalCommandNotifications: true },
    }));
    const first = createTerminal("one");
    const second = createTerminal("two");
    useTerminalStore.getState().actions.registerSession(first, {});
    useTerminalStore.getState().actions.registerSession(second, {});
    await render();
    const command = { status: "failure" as const, exitCode: 1, durationMs: 4000, finishedAt: 1 };
    await emit("terminal:command-finished", { terminalId: first, command });
    expect(useTerminalStore.getState().sessions.get(first)?.lastCommand).toEqual(command);
    expect(io.notified).toEqual([{ terminalId: first, isTerminalVisible: false }]);

    await act(async () => io.activate?.(first));
    await wait();
    expect(isPaneVisible()).toBe(true);
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe(first);
    expect(useTerminalStore.getState().sessions.get(first)?.lastCommand).toBeUndefined();

    await emit("terminal:command-finished", { terminalId: first, command });
    expect(last(io.notified)).toEqual({ terminalId: first, isTerminalVisible: true });
    await emit("terminal:command-finished", { terminalId: "gone", command });
    expect(io.notified).toHaveLength(2);
  });

  it("hands a terminal over to an editor tab without ending its session", async () => {
    const first = createTerminal("one", { customName: true });
    useTerminalStore.getState().actions.registerSession(first, { connectionId: "pty-1" });
    await render();
    await showPane();
    await emit("terminal:detach-to-buffer", { terminalId: first });
    await wait(30);
    expect(tabs()).toHaveLength(0);
    expect(useTerminalStore.getState().sessions.get(first)).toMatchObject({
      name: "one",
      customName: true,
    });
    expect(io.invoked.some((call) => call.cmd === "close_terminal")).toBe(false);
  });
});

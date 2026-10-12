// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { PaneNode } from "@/features/panes/types/pane.types";
import type { Terminal } from "../types/terminal.types";

const actions = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { cleared: [] as string[], exported: [] as Array<[string, string]> };
});

vi.mock("../services/terminal-tab-actions", () => ({
  clearTerminal: (id: string) => actions.cleared.push(id),
  exportTerminalOutput: async (id: string, name: string) => {
    actions.exported.push([id, name]);
  },
}));

const { default: TerminalTabBar } = await import("../components/terminal-tab-bar");

enableMapSet();

const terminal = (id: string, name: string, extra: Partial<Terminal> = {}): Terminal => ({
  id,
  name,
  currentDirectory: `/repo/${id}`,
  customName: true,
  createdAt: new Date("2026-10-01"),
  ...extra,
});

const events = {
  onNewTerminal: vi.fn(),
  onTabCreate: vi.fn(),
  onCloseOtherTabs: vi.fn(),
  onCloseAllTabs: vi.fn(),
  onCloseTabsToRight: vi.fn(),
  onSearchTerminal: vi.fn(),
  onNextTerminal: vi.fn(),
  onPrevTerminal: vi.fn(),
  onFullScreen: vi.fn(),
  onSplitTerminal: vi.fn(),
  onUnsplitTerminal: vi.fn(),
};

let root: Root;
let container: HTMLDivElement;
let current: { terminals: Terminal[]; activeId: string | null };

function Harness({
  initial,
  layouts,
  bare = false,
}: {
  initial: Terminal[];
  layouts?: PaneNode[];
  bare?: boolean;
}) {
  const [terminals, setTerminals] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  current = { terminals, activeId };
  if (bare) {
    return (
      <TerminalTabBar
        terminals={terminals}
        activeTerminalId={activeId}
        onTabClick={setActiveId}
        onTabClose={(id) => setTerminals((items) => items.filter((item) => item.id !== id))}
      />
    );
  }
  return (
    <TerminalTabBar
      terminals={terminals}
      activeTerminalId={activeId}
      layouts={layouts}
      onTabClick={setActiveId}
      onTabClose={(id) => setTerminals((items) => items.filter((item) => item.id !== id))}
      onTabPin={(id) =>
        setTerminals((items) =>
          items.map((item) => (item.id === id ? { ...item, isPinned: !item.isPinned } : item)),
        )
      }
      onTabRename={(id, name) =>
        setTerminals((items) => items.map((item) => (item.id === id ? { ...item, name } : item)))
      }
      {...events}
    />
  );
}

async function flush(ms = 0) {
  await act(async () => {
    for (let index = 0; index < 3; index++) await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function render(initial: Terminal[], options: { layouts?: PaneNode[]; bare?: boolean } = {}) {
  await act(async () => root.render(<Harness initial={initial} {...options} />));
  await flush();
}

const view = () => within(container);
const tabs = () => view().getAllByRole("tab");
const tabNames = () => tabs().map((tab) => tab.getAttribute("aria-label"));
const tab = (name: string) =>
  tabs().find((element) => element.getAttribute("aria-label")?.startsWith(name))!;

async function key(target: HTMLElement, value: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(target, { key: value, ...init });
  });
  await flush();
}

async function openMenu(target: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(target, { clientX: 15, clientY: 15 });
  });
  await flush();
}

async function choose(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`No menu item ${label}`);
  await act(async () => item.click());
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  actions.cleared.length = 0;
  actions.exported.length = 0;
  for (const fn of Object.values(events)) fn.mockReset();
  vi.spyOn(commands, "listShells").mockResolvedValue([
    { id: "zsh", name: "zsh", exec_unix: "/bin/zsh" } as never,
  ]);
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("terminal tab bar", () => {
  it("says when there are no terminals", async () => {
    await render([], { bare: true });
    expect(view().getByText("No terminals")).toBeTruthy();
    expect(view().queryByRole("button", { name: "New terminal" })).toBeNull();
  });

  it("switches and closes terminals with the mouse and keyboard", async () => {
    await render([terminal("t1", "zsh"), terminal("t2", "server"), terminal("t3", "tests")]);
    expect(tabNames()).toEqual(["zsh", "server", "tests"]);

    await act(async () => tab("server").click());
    expect(current.activeId).toBe("t2");

    await key(tab("server"), "ArrowRight");
    expect(current.activeId).toBe("t3");
    await key(tab("tests"), "Home");
    expect(current.activeId).toBe("t1");
    await key(tab("zsh"), "Enter");
    expect(current.activeId).toBe("t1");

    await key(tab("tests"), "Delete");
    expect(tabNames()).toEqual(["zsh", "server"]);
  });

  it("pins terminals in front and protects them from keyboard close", async () => {
    await render([terminal("t1", "zsh"), terminal("t2", "server")]);
    await openMenu(tab("server"));
    await choose("Pin Terminal");
    expect(tabNames()).toEqual(["server (pinned)", "zsh"]);

    await key(tab("server"), "Backspace");
    expect(tabNames()).toEqual(["server (pinned)", "zsh"]);

    await openMenu(tab("server"));
    await choose("Unpin Terminal");
    expect(tabNames()).toEqual(["zsh", "server"]);
  });

  it("renames a terminal with F2 and from the menu", async () => {
    await render([terminal("t1", "zsh"), terminal("t2", "server")]);
    await key(tab("server"), "F2");
    await flush(10);
    const input = view().getByRole("textbox", { name: "Rename server" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "  api  " } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(tabNames()).toEqual(["zsh", "api"]);
    expect(current.activeId).toBe("t2");

    await openMenu(tab("zsh"));
    await choose("Rename Terminal");
    await flush(10);
    const rename = view().getByRole("textbox", { name: "Rename zsh" });
    await act(async () => {
      fireEvent.keyDown(rename, { key: "Escape" });
    });
    expect(view().queryByRole("textbox", { name: "Rename zsh" })).toBeNull();
    expect(tabNames()).toEqual(["zsh", "api"]);
  });

  it("runs terminal actions from the tab menu", async () => {
    await render([terminal("t1", "zsh", { shell: "zsh" }), terminal("t2", "server")]);
    await key(tab("zsh"), "F10", { shiftKey: true });
    await choose("Clear Terminal");
    expect(actions.cleared).toEqual(["t1"]);

    await openMenu(tab("zsh"));
    await choose("Duplicate Terminal");
    expect(events.onTabCreate).toHaveBeenCalledWith("/repo/t1", "zsh", undefined);

    await openMenu(tab("zsh"));
    await choose("Export Output");
    expect(actions.exported).toEqual([["t1", "zsh"]]);

    await openMenu(tab("zsh"));
    await choose("Split Right");
    expect(events.onSplitTerminal).toHaveBeenCalledWith("right", "t1");

    await openMenu(tab("zsh"));
    await choose("Split Down");
    expect(events.onSplitTerminal).toHaveBeenLastCalledWith("down", "t1");

    await openMenu(tab("zsh"));
    await choose("Close Other Terminals");
    expect(events.onCloseOtherTabs).toHaveBeenCalledWith("t1");

    await openMenu(tab("zsh"));
    await choose("Close Terminals to Right");
    expect(events.onCloseTabsToRight).toHaveBeenCalledWith("t1");

    await openMenu(tab("zsh"));
    await choose("Close All Terminals");
    expect(events.onCloseAllTabs).toHaveBeenCalled();

    await openMenu(tab("server"));
    await choose("Close Terminal");
    expect(tabNames()).toEqual(["zsh"]);
  });

  it("offers to unsplit a terminal that is part of a split", async () => {
    const layouts = [
      {
        id: "split-1",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "g1", type: "group", bufferIds: ["t1"], activeBufferId: "t1" },
          { id: "g2", type: "group", bufferIds: ["t2"], activeBufferId: "t2" },
        ],
        sizes: [50, 50],
      },
    ] as unknown as PaneNode[];
    await render([terminal("t1", "zsh"), terminal("t2", "server")], { layouts });
    expect(view().getAllByLabelText("Part of a split group").length).toBeGreaterThan(0);
    await openMenu(tab("zsh"));
    await choose("Unsplit");
    expect(events.onUnsplitTerminal).toHaveBeenCalledWith("t1");
  });

  it("opens toolbar actions from the empty bar area", async () => {
    await render([terminal("t1", "zsh")]);
    const bar = view().getByRole("tablist", { name: "Terminal tabs" });

    await openMenu(bar);
    await choose("New Terminal");
    expect(events.onNewTerminal).toHaveBeenCalled();

    await openMenu(bar);
    await choose("Search");
    expect(events.onSearchTerminal).toHaveBeenCalled();

    await openMenu(bar);
    await choose("Next Tab");
    expect(events.onNextTerminal).toHaveBeenCalled();

    await openMenu(bar);
    await choose("Previous Tab");
    expect(events.onPrevTerminal).toHaveBeenCalled();

    await openMenu(bar);
    await choose("Full Screen");
    expect(events.onFullScreen).toHaveBeenCalledTimes(1);

    await act(async () => view().getByRole("button", { name: "Find in terminal" }).click());
    expect(events.onSearchTerminal).toHaveBeenCalledTimes(2);
    await act(async () => view().getByRole("button", { name: "Full screen terminal" }).click());
    expect(events.onFullScreen).toHaveBeenCalledTimes(2);
  });

  it("starts a new terminal from a shell profile", async () => {
    await render([terminal("t1", "zsh")]);
    await act(async () => view().getByRole("button", { name: "New terminal" }).click());
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.length).toBeGreaterThan(0);
    await act(async () => items[0].click());
    expect(events.onNewTerminal).toHaveBeenCalledWith(expect.any(String));
  });
});

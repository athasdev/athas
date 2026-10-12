// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { getAllPaneGroups } from "@/features/panes/services/pane-tree";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";

const native = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { clipboard: [] as string[] };
});

vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    native.clipboard.push(text);
  },
}));

const { default: TabBar } = await import("../components/tab-bar");

enableMapSet();

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 3; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(paneId: string = ROOT_PANE_ID) {
  await act(async () => root.render(<TabBar paneId={paneId} />));
  await flush();
}

const tabs = () => within(container).getAllByRole("tab");
const tabLabels = () => tabs().map((tab) => tab.getAttribute("aria-label"));
const tab = (name: string) =>
  tabs().find((element) => element.getAttribute("aria-label")?.startsWith(name))!;
const rootPane = () => usePaneStore.getState().root as { activeBufferId: string | null };
const status = () =>
  container.querySelector('[aria-live="polite"][aria-atomic="true"]')?.textContent;

function open(path: string, content = "") {
  const name = path.split("/").pop()!;
  return useBufferStore.getState().actions.openBuffer(path, name, content);
}

async function contextMenu(element: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 20, clientY: 20 });
  });
  await flush();
}

async function chooseMenuItem(label: string) {
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
  native.clipboard.length = 0;
  useProjectStore.setState({ rootFolderPath: "/repo" });
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
});

describe("editor tab bar", () => {
  it("shows open files with distinguishing names and switches between them", async () => {
    const first = open("/repo/src/a/index.ts");
    const second = open("/repo/src/b/index.ts");
    open("/repo/README.md");
    await render();

    expect(tabLabels()).toEqual(["index.ts", "index.ts", "README.md"]);
    expect(container.textContent).toContain("a/index.ts");
    expect(container.textContent).toContain("b/index.ts");

    await act(async () => tabs()[0].click());
    expect(rootPane().activeBufferId).toBe(first);
    expect(status()).toBe("Switched to index.ts");

    await act(async () => {
      fireEvent.keyDown(tabs()[0], { key: "ArrowRight" });
    });
    expect(rootPane().activeBufferId).toBe(second);

    await act(async () => {
      fireEvent.keyDown(tabs()[1], { key: "Enter" });
    });
    expect(status()).toBe("Activated index.ts");

    await act(async () => {
      fireEvent.keyDown(tab("README.md"), { key: "Delete" });
    });
    expect(tabLabels()).toEqual(["index.ts", "index.ts"]);
    expect(status()).toBe("Closed README.md");
  });

  it("keeps pinned tabs first and refuses to close them from the keyboard", async () => {
    open("/repo/one.ts");
    const second = open("/repo/two.ts");
    await render();

    await contextMenu(tab("two.ts"));
    await chooseMenuItem("Pin Tab");
    expect(tabLabels()).toEqual(["two.ts (pinned)", "one.ts"]);

    await act(async () => {
      fireEvent.keyDown(tab("two.ts"), { key: "Backspace" });
    });
    expect(status()).toBe("Cannot close pinned tab two.ts");
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === second)).toBe(true);

    await contextMenu(tab("two.ts"));
    await chooseMenuItem("Unpin Tab");
    expect(tabLabels()).toEqual(["one.ts", "two.ts"]);
  });

  it("copies paths and closes tabs from the context menu", async () => {
    open("/repo/src/app.ts");
    open("/repo/src/util.ts");
    await render();

    await contextMenu(tab("app.ts"));
    await chooseMenuItem("Copy Path");
    expect(last(native.clipboard)).toBe("/repo/src/app.ts");

    await contextMenu(tab("app.ts"));
    await chooseMenuItem("Copy Relative Path");
    expect(last(native.clipboard)).toBe("src/app.ts");

    await contextMenu(tab("app.ts"));
    await chooseMenuItem("Close");
    expect(tabLabels()).toEqual(["util.ts"]);
  });

  it("splits a tab into a new editor group and locks a group", async () => {
    const buffer = open("/repo/src/app.ts");
    await render();
    await contextMenu(tab("app.ts"));
    await chooseMenuItem("Split Right");
    const groups = getAllPaneGroups(usePaneStore.getState().root);
    expect(groups).toHaveLength(2);
    expect(groups[1].bufferIds).toContain(buffer);

    await render(ROOT_PANE_ID);
    expect(within(container).getByRole("button", { name: "Close split" })).toBeTruthy();

    await contextMenu(tab("app.ts"));
    await chooseMenuItem("Lock Editor Group");
    expect(
      getAllPaneGroups(usePaneStore.getState().root).find((group) => group.id === ROOT_PANE_ID)
        ?.locked,
    ).toBe(true);

    await act(async () => within(container).getByRole("button", { name: "Close split" }).click());
    expect(getAllPaneGroups(usePaneStore.getState().root)).toHaveLength(1);
  });

  it("toggles the editor group full screen", async () => {
    open("/repo/src/app.ts");
    await render();
    await act(async () =>
      within(container).getByRole("button", { name: "Full screen editor" }).click(),
    );
    expect(usePaneStore.getState().fullscreenPaneId).toBe(ROOT_PANE_ID);
    expect(
      within(container)
        .getByRole("button", { name: "Exit full screen" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("closes the oldest unpinned tabs beyond the open tab limit", async () => {
    const maxOpenTabs = useSettingsStore.getState().settings.maxOpenTabs;
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, maxOpenTabs: 2 } }));
    open("/repo/one.ts");
    open("/repo/two.ts");
    open("/repo/three.ts");
    await render();
    expect(tabLabels()).toEqual(["two.ts", "three.ts"]);
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, maxOpenTabs } }));
  });

  it("names terminal tabs after their title, command or folder and renames them", async () => {
    const { openTerminalBuffer } = useBufferStore.getState().actions;
    const byCommand = openTerminalBuffer({ command: "/usr/bin/htop -d 5", sessionId: "s1" });
    openTerminalBuffer({ workingDirectory: "/repo/packages/api/", sessionId: "s2" });
    openTerminalBuffer({ sessionId: "s3" });
    useTerminalStore.setState({
      sessions: new Map([
        ["s1", { id: "s1" }],
        ["s2", { id: "s2" }],
        ["s3", { id: "s3", title: "vim" }],
      ]),
    });
    await render();

    const names = tabs().map((element) => element.textContent?.trim());
    expect(names).toEqual(["htop", "api", "vim"]);

    await contextMenu(tabs()[0]);
    await chooseMenuItem("Rename");
    const input = within(container).getByRole("textbox", { name: "Rename htop" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "monitor" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(useTerminalStore.getState().sessions.get("s1")).toMatchObject({
      name: "monitor",
      customName: true,
    });
    expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === byCommand)?.name).toBe(
      "monitor",
    );
    expect(tabs()[0].textContent?.trim()).toBe("monitor");
  });

  it("turns a preview tab into a regular tab on double click", async () => {
    const id = useBufferStore
      .getState()
      .actions.openBuffer(
        "/repo/peek.ts",
        "peek.ts",
        "",
        false,
        undefined,
        false,
        false,
        undefined,
        false,
        false,
        false,
        undefined,
        true,
      );
    await render();
    expect(tabLabels()).toEqual(["peek.ts (preview)"]);
    await act(async () => {
      fireEvent.doubleClick(tab("peek.ts"));
    });
    expect(tabLabels()).toEqual(["peek.ts"]);
    expect(rootPane().activeBufferId).toBe(id);
  });
});

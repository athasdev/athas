// @vitest-environment jsdom
import { createEvent, fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { findPaneGroup } from "@/features/panes/services/pane-tree";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { setInternalTabDragData } from "@/features/tabs/services/internal-tab-drag";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { onAppEvent } from "@/utils/app-events";
import { useUIState } from "../stores/ui-state.store";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("@/features/terminal/components/terminal-container", () => ({
  default: ({
    currentDirectory,
    onFullScreen,
    isFullScreen,
  }: {
    currentDirectory?: string;
    onFullScreen?: () => void;
    isFullScreen?: boolean;
  }) => (
    <section aria-label="Terminals" data-directory={currentDirectory}>
      <button type="button" onClick={onFullScreen}>
        {isFullScreen ? "Exit terminal full screen" : "Terminal full screen"}
      </button>
    </section>
  ),
}));
vi.mock("@/features/debugger/components/debugger-view", () => ({
  default: ({ onClose, onFullScreen }: { onClose: () => void; onFullScreen: () => void }) => (
    <section aria-label="Run and Debug">
      <button type="button" onClick={onFullScreen}>
        Debugger full screen
      </button>
      <button type="button" onClick={onClose}>
        Close debugger
      </button>
    </section>
  ),
}));
vi.mock("../components/bottom-pane/bottom-buffer-pane", () => ({
  BottomBufferPane: () => {
    const bottomRoot = usePaneStore.use.bottomRoot();
    const group = findPaneGroup(bottomRoot, BOTTOM_PANE_ID);
    return <section aria-label="Bottom buffers">{group?.bufferIds.join(",")}</section>;
  },
}));

const { default: BottomPane } = await import("../components/bottom-pane/bottom-pane");

enableMapSet();

let root: Root;
let container: HTMLDivElement;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () => root.render(<BottomPane />));
  await flush();
}

async function show(tab: string, visible = true) {
  await act(async () => {
    useUIState.getState().setBottomPaneActiveTab(tab as never);
    useUIState.getState().setIsBottomPaneVisible(visible);
  });
  await flush();
}

const view = () => within(document.body);
const visible = () => useUIState.getState().isBottomPaneVisible;
const dropTarget = () => container.querySelector<HTMLElement>("[data-bottom-pane-drop-target]")!;
const frame = () => container.firstElementChild as HTMLElement;
const bottomBuffers = () => findPaneGroup(usePaneStore.getState().bottomRoot, BOTTOM_PANE_ID)!;

function transfer(data: Record<string, string>) {
  return {
    types: Object.keys(data),
    dropEffect: "none",
    getData: (type: string) => data[type] ?? "",
  };
}

async function dropOn(data: ReturnType<typeof transfer>) {
  await act(async () => {
    fireEvent(dropTarget(), createEvent.dragOver(dropTarget(), { dataTransfer: data }));
    fireEvent(dropTarget(), createEvent.drop(dropTarget(), { dataTransfer: data }));
  });
  await flush();
}

function setFeatures(features: Partial<{ terminal: boolean; debugger: boolean }>) {
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, coreFeatures: { ...state.settings.coreFeatures, ...features } },
  }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  setFeatures({ terminal: true, debugger: true });
  useProjectStore.setState({ rootFolderPath: "/repo" });
  useUIState.setState({ isBottomPaneVisible: false, bottomPaneActiveTab: "terminal" });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  setFeatures({ terminal: true, debugger: true });
  vi.unstubAllGlobals();
});

describe("bottom pane", () => {
  it("keeps the terminal mounted in the project folder and stays hidden until shown", async () => {
    await render();
    expect(view().getByRole("region", { name: "Terminals" }).dataset.directory).toBe("/repo");
    expect(view().getByRole("separator", { name: "Resize bottom pane" })).toBeTruthy();
    await show("terminal");
    expect(visible()).toBe(true);

    setFeatures({ terminal: false });
    await flush();
    expect(view().queryByRole("region", { name: "Terminals" })).toBeNull();
  });

  it("resizes with the gutter within its limits", async () => {
    await render();
    await show("terminal");
    const gutter = view().getByRole("separator", { name: "Resize bottom pane" });
    await act(async () => {
      fireEvent.mouseDown(gutter, { clientY: 600 });
    });
    expect(document.body.style.cursor).toBe("ns-resize");
    await act(async () => {
      fireEvent.mouseMove(document, { clientY: 400 });
    });
    expect(frame().style.getPropertyValue("--bottom-pane-height")).toContain("520px");
    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(document.body.style.cursor).toBe("");
    expect(frame().style.getPropertyValue("--bottom-pane-height")).toContain("520px");

    await act(async () => {
      fireEvent.mouseDown(gutter, { clientY: 400 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientY: 2000 });
      fireEvent.mouseUp(document);
    });
    expect(frame().style.getPropertyValue("--bottom-pane-height")).toContain("200px");
  });

  it("toggles full screen and renders nothing full screen once hidden", async () => {
    await render();
    await show("terminal");
    await act(async () => view().getByRole("button", { name: "Terminal full screen" }).click());
    expect(view().getByRole("button", { name: "Exit terminal full screen" })).toBeTruthy();
    expect(view().queryByRole("separator", { name: "Resize bottom pane" })).toBeNull();
    expect(document.querySelector('[data-slot="workbench-fullscreen-surface"]')).not.toBeNull();

    await show("terminal", false);
    expect(document.querySelector('[data-slot="workbench-fullscreen-surface"]')).toBeNull();
  });

  it("shows the debugger and closes the pane from it", async () => {
    await render();
    await show("debugger");
    expect(await view().findByRole("region", { name: "Run and Debug" })).toBeTruthy();
    await act(async () => view().getByRole("button", { name: "Debugger full screen" }).click());
    expect(document.querySelector('[data-slot="workbench-fullscreen-surface"]')).not.toBeNull();
    await act(async () => view().getByRole("button", { name: "Close debugger" }).click());
    expect(visible()).toBe(false);
  });

  it("hides itself for tabs it cannot show", async () => {
    await render();
    await show("diagnostics");
    expect(visible()).toBe(false);
    await show("references");
    expect(visible()).toBe(false);
    await show("buffers");
    expect(visible()).toBe(false);
    setFeatures({ debugger: false });
    await show("debugger");
    expect(visible()).toBe(false);
  });

  it("moves an editor tab dropped on it into the bottom buffers", async () => {
    const bufferId = useBufferStore.getState().actions.openBuffer("/repo/a.ts", "a.ts", "");
    await render();
    await dropOn(
      transfer({
        "application/tab-data": JSON.stringify({ bufferId, paneId: ROOT_PANE_ID }),
      }),
    );
    expect(bottomBuffers().bufferIds).toEqual([bufferId]);
    expect(bottomBuffers().activeBufferId).toBe(bufferId);
    expect(useUIState.getState().bottomPaneActiveTab).toBe("buffers");
    expect(visible()).toBe(true);
    expect(view().getByRole("region", { name: "Bottom buffers" }).textContent).toBe(bufferId);
  });

  it("detaches a terminal from the panel into the bottom buffers", async () => {
    const detached: string[] = [];
    const unsubscribe = onAppEvent("terminal:detach-to-buffer", ({ terminalId }) =>
      detached.push(terminalId),
    );
    await render();
    setInternalTabDragData({
      source: "terminal-panel",
      terminalId: "term-7",
      name: "watch",
      initialCommand: "bun test --watch",
    });
    await dropOn(transfer({}));
    expect(detached).toEqual(["term-7"]);
    const terminal = useBufferStore.getState().buffers.find((buffer) => buffer.type === "terminal");
    expect(terminal?.name).toBe("watch");
    expect(bottomBuffers().bufferIds).toEqual([terminal?.id]);
    expect(window.__athasInternalTabDragData).toBeUndefined();
    unsubscribe();
  });

  it("ignores unrelated or malformed drops", async () => {
    const bufferId = useBufferStore.getState().actions.openBuffer("/repo/a.ts", "a.ts", "");
    await render();
    await dropOn(transfer({ "text/plain": "hello" }));
    await dropOn(transfer({ "application/tab-data": "{broken" }));
    await dropOn(
      transfer({
        "application/tab-data": JSON.stringify({ bufferId, paneId: BOTTOM_PANE_ID }),
      }),
    );
    expect(bottomBuffers().bufferIds).toEqual([]);
    expect(visible()).toBe(false);
  });
});

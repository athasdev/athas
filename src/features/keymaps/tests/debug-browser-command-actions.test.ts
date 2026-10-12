// @vitest-environment jsdom
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

import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import {
  restartDebugSession,
  startGeneratedDebugSession,
  stopDebugSession,
  toggleActiveBreakpoint,
  toggleDebuggerPane,
} from "../commands/debug-command-actions";
import {
  focusBrowserAddressBar,
  openNewBrowserTab,
  openUrlInBrowserTab,
  runActiveBrowserAction,
} from "../commands/browser-command-actions";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  manager: {
    focusWorkbench: vi.fn(async () => {}),
    openDevTools: vi.fn(),
    perform: vi.fn(),
    zoom: vi.fn(),
  },
}));

vi.mock("@/ui/dialog", () => ({ showPromptDialog: mocks.prompt }));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: mocks.manager,
}));

const ui = () => useUIState.getState();
const breakpoints = () =>
  useDebuggerStore.getState().breakpoints.map(({ filePath, line }) => [filePath, line]);
const activeBuffer = () => useBufferStore.getState().actions.getActiveBuffer();

function editor(overrides: Partial<EditorContent> = {}): EditorContent {
  return {
    id: "file",
    type: "editor",
    path: "/ws/main.py",
    name: "main.py",
    content: "print(1)\nprint(2)\n",
    savedContent: "print(1)\nprint(2)\n",
    isDirty: false,
    isVirtual: false,
    language: "python",
    ...overrides,
  };
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  window.localStorage.clear();
  useDebuggerStore.setState({ breakpoints: [] });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  useBufferStore.setState({ buffers: [] });
  seedActiveBuffer(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("debugger commands", () => {
  it("toggles the debugger tab in the bottom pane", () => {
    ui().setIsBottomPaneVisible(false);

    toggleDebuggerPane();
    expect(ui().isBottomPaneVisible).toBe(true);
    expect(ui().bottomPaneActiveTab).toBe("debugger");

    toggleDebuggerPane();
    expect(ui().isBottomPaneVisible).toBe(false);

    ui().setBottomPaneActiveTab("terminal");
    ui().setIsBottomPaneVisible(true);
    toggleDebuggerPane();
    expect(ui().isBottomPaneVisible).toBe(true);
    expect(ui().bottomPaneActiveTab).toBe("debugger");
  });

  it("toggles a breakpoint on the cursor line of the active file", () => {
    useBufferStore.setState({ buffers: [editor()] });
    seedActiveBuffer("file");
    useEditorStateStore.setState({ cursorPosition: { line: 1, column: 0, offset: 9 } });

    toggleActiveBreakpoint();
    expect(breakpoints()).toEqual([["/ws/main.py", 1]]);

    toggleActiveBreakpoint();
    expect(breakpoints()).toEqual([]);
  });

  it("ignores breakpoints for virtual or non-editor buffers", () => {
    useBufferStore.setState({ buffers: [editor({ isVirtual: true })] });
    seedActiveBuffer("file");
    toggleActiveBreakpoint();

    useBufferStore.setState({ buffers: [] });
    seedActiveBuffer(null);
    toggleActiveBreakpoint();

    expect(breakpoints()).toEqual([]);
  });

  it.each([
    ["debugger:start", startGeneratedDebugSession],
    ["debugger:stop", stopDebugSession],
    ["debugger:restart", restartDebugSession],
  ] as const)("opens the debugger pane and emits %s", (event, run) => {
    const handler = vi.fn();
    cleanups.push(onAppEvent(event, handler));
    ui().setIsBottomPaneVisible(false);

    run();

    expect(ui().isBottomPaneVisible).toBe(true);
    expect(ui().bottomPaneActiveTab).toBe("debugger");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("browser commands", () => {
  it("opens a new browser tab at the given address", () => {
    openNewBrowserTab("https://example.com");
    expect(activeBuffer()).toMatchObject({ type: "browser", url: "https://example.com" });
  });

  it("resolves a typed address before opening it", async () => {
    mocks.prompt.mockResolvedValueOnce("localhost:5173");
    await openUrlInBrowserTab();
    expect(activeBuffer()).toMatchObject({ type: "browser", url: "http://localhost:5173" });
  });

  it("opens nothing when the prompt is dismissed or blank", async () => {
    mocks.prompt.mockResolvedValueOnce(null);
    await openUrlInBrowserTab();
    mocks.prompt.mockResolvedValueOnce("   ");
    await openUrlInBrowserTab();

    expect(useBufferStore.getState().buffers).toEqual([]);
  });

  it("acts on the active browser tab only", async () => {
    await focusBrowserAddressBar();
    await runActiveBrowserAction("reload");
    expect(mocks.manager.focusWorkbench).not.toHaveBeenCalled();
    expect(mocks.manager.perform).not.toHaveBeenCalled();

    openNewBrowserTab("https://example.com");
    const bufferId = activeBuffer()!.id;
    const focusAddress = vi.fn();
    cleanups.push(onAppEvent("browser:focus-address-bar", focusAddress));

    await focusBrowserAddressBar();
    expect(mocks.manager.focusWorkbench).toHaveBeenCalledTimes(1);
    expect(focusAddress).toHaveBeenCalledWith(bufferId);

    await runActiveBrowserAction("back");
    await runActiveBrowserAction("devtools");
    expect(mocks.manager.perform).toHaveBeenCalledWith(bufferId, "back");
    expect(mocks.manager.openDevTools).toHaveBeenCalledWith(bufferId);
  });
});

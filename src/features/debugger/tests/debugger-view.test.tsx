// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { emitAppEvent, onAppEvent } from "@/utils/app-events";
import { useDebuggerStore } from "../stores/debugger.store";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    files: new Map<string, string>(),
    calls: [] as string[],
    requests: [] as Array<[string, string, unknown]>,
    failNext: null as string | null,
    capabilities: {} as Record<string, unknown>,
    changedClasses: [] as string[],
  };
});

function fail(name: string) {
  if (io.failNext !== name) return;
  io.failNext = null;
  throw new Error(`${name} failed`);
}

vi.mock("../services/debug-adapter-service", async () => {
  const actual = await vi.importActual<typeof import("../services/debug-adapter-service")>(
    "../services/debug-adapter-service",
  );
  return {
    getExceptionBreakpointFilters: actual.getExceptionBreakpointFilters,
    startDebugLaunchSession: async (config: { adapterCommand: string; adapterArgs?: string[] }) => {
      io.calls.push(`start ${config.adapterCommand}`);
      fail("start");
      return {
        id: "adapter-1",
        command: config.adapterCommand,
        args: config.adapterArgs ?? [],
        cwd: "/repo",
        capabilities: io.capabilities,
      };
    },
    startJavaDebugLaunchSession: async (_config: unknown, _breakpoints: unknown, path: string) => {
      io.calls.push(`java ${path}`);
      fail("java");
      return { id: "java-1", command: "jdt", args: [], cwd: "/repo", capabilities: {} };
    },
    disconnectDebugAdapterSession: async (id: string) => {
      io.calls.push(`disconnect ${id}`);
    },
    restartDebugAdapterSession: async (id: string) => {
      io.calls.push(`restart ${id}`);
    },
    sendDebugAdapterRequest: async (id: string, command: string, args: unknown) => {
      io.requests.push([id, command, args]);
      fail(command);
      return io.requests.length;
    },
    syncDebugBreakpoints: async (id: string, breakpoints: unknown[]) => {
      io.calls.push(`sync ${id} ${breakpoints.length}`);
    },
    syncExceptionBreakpoints: async (id: string, filters: string[]) => {
      io.calls.push(`exceptions ${id} ${filters.join(",")}`);
      fail("exceptions");
    },
    applyJavaHotCodeReplace: async () => {
      fail("hotswap");
      return { changedClasses: io.changedClasses };
    },
  };
});
vi.mock("@/features/file-system/api/file-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-operations")>()),
  readFileContent: async (path: string) => {
    const content = io.files.get(path);
    if (content === undefined) throw new Error("missing");
    return content;
  },
}));

const { default: DebuggerView } = await import("../components/debugger-view");

enableMapSet();

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let closes: number;
let fullScreens: number;
let opened: string[];

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(isFullScreen = false) {
  await act(async () =>
    root.render(
      <DebuggerView
        isFullScreen={isFullScreen}
        onClose={() => closes++}
        onFullScreen={() => fullScreens++}
      />,
    ),
  );
  await flush();
}

const view = () => within(container);
const button = (name: string) => view().getByRole("button", { name });
const panel = (name: RegExp) => view().getByRole("tab", { name });
const session = () => useDebuggerStore.getState().activeSession;

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await flush();
}

async function openPanel(name: RegExp) {
  await act(async () => {
    fireEvent.click(panel(name));
  });
  await flush();
}

function openFile(path: string) {
  return useBufferStore.getState().actions.openBuffer(path, path.split("/").pop()!, "code");
}

function launchJson(configurations: unknown[]) {
  io.files.set("/repo/.vscode/launch.json", JSON.stringify({ configurations }));
}

async function pauseAt(threadId = 7) {
  await act(async () => {
    useDebuggerStore.getState().actions.setThreads([{ id: threadId, name: "main" }]);
    useDebuggerStore.getState().actions.setStoppedState({
      reason: "breakpoint",
      threadId,
      description: "Paused on breakpoint",
    } as never);
    useDebuggerStore.getState().actions.setSessionStatus("paused");
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  window.localStorage.clear();
  io.files = new Map();
  io.calls = [];
  io.requests = [];
  io.failNext = null;
  io.capabilities = {};
  io.changedClasses = [];
  closes = 0;
  fullScreens = 0;
  opened = [];
  useDebuggerStore.setState({
    breakpoints: [],
    workspaceConfigs: [],
    userConfigs: [],
    activeConfigId: null,
    activeSession: null,
    adapterOutput: [],
    threads: [],
    stackFrames: [],
    selectedFrameId: null,
    scopes: [],
    stoppedState: null,
    pendingRequests: {},
    adapterCapabilities: {},
  });
  useProjectStore.setState({ rootFolderPath: "/repo" });
  useFileSystemStore.setState({
    handleFileOpen: async (path: string) => {
      opened.push(path);
    },
  } as never);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("debugger view", () => {
  it("explains a missing launch.json and offers a custom command without an open file", async () => {
    await render();
    expect(view().getByText("/repo")).toBeTruthy();
    expect(button("Start debugging").hasAttribute("disabled")).toBe(true);
    expect(button("Toggle breakpoint at cursor").hasAttribute("disabled")).toBe(true);

    const command = view().getByPlaceholderText("Command to run");
    await act(async () => {
      fireEvent.change(command, { target: { value: "make debug" } });
    });
    expect(button("Start debugging").hasAttribute("disabled")).toBe(false);

    const created: Array<{ command: string; workingDirectory?: string }> = [];
    const unsubscribe = onAppEvent("terminal:create-with-command", (request) =>
      created.push(request),
    );
    await click(button("Start debugging"));
    expect(created).toEqual([
      { name: "Custom debug command", command: "make debug", workingDirectory: "/repo" },
    ]);
    expect(session()).toMatchObject({ status: "running", command: "make debug" });
    expect(view().getAllByText("running").length).toBeGreaterThan(0);

    const closed: string[] = [];
    const unsubscribeClose = onAppEvent("terminal:close-active", () => closed.push("closed"));
    await click(button("Stop debugging"));
    expect(closed).toEqual(["closed"]);
    expect(session()?.status).toBe("idle");
    unsubscribe();
    unsubscribeClose();
  });

  it("generates a configuration for the active file and runs it in a terminal", async () => {
    openFile("/repo/src/main.py");
    await render();
    expect(view().getByText("python -m pdb /repo/src/main.py")).toBeTruthy();
    const created: string[] = [];
    const unsubscribe = onAppEvent("terminal:create-with-command", ({ command }) =>
      created.push(command),
    );
    await act(async () => emitAppEvent("debugger:start"));
    await flush();
    expect(created).toEqual(["python -m pdb /repo/src/main.py"]);

    await act(async () => emitAppEvent("debugger:restart"));
    await flush();
    expect(created).toHaveLength(2);
    await act(async () => emitAppEvent("debugger:stop"));
    await flush();
    expect(session()?.status).toBe("idle");
    unsubscribe();
  });

  it("toggles a breakpoint at the cursor and manages the breakpoint list", async () => {
    openFile("/repo/src/app.ts");
    useEditorStateStore.setState({ cursorPosition: { line: 4, column: 0, offset: 0 } });
    await render();
    await click(button("Toggle breakpoint at cursor"));
    expect(useDebuggerStore.getState().breakpoints).toMatchObject([
      { filePath: "/repo/src/app.ts", line: 4, enabled: true },
    ]);

    await openPanel(/^Breakpoints/);
    expect(view().getByText("Line 5")).toBeTruthy();
    await click(button("Disable breakpoint"));
    expect(useDebuggerStore.getState().breakpoints[0].enabled).toBe(false);

    await click(view().getByText("app.ts").closest("button")!);
    expect(opened).toEqual(["/repo/src/app.ts"]);

    await click(button("Remove breakpoint"));
    expect(useDebuggerStore.getState().breakpoints).toEqual([]);

    await click(button("Toggle breakpoint at cursor"));
    await click(button("Clear breakpoints"));
    expect(useDebuggerStore.getState().breakpoints).toEqual([]);
  });

  it("starts an adapter session from launch.json and drives it while paused", async () => {
    launchJson([
      {
        name: "Attach node",
        type: "node",
        adapterCommand: "node-debug",
        adapterArgs: ["--stdio"],
      },
    ]);
    io.capabilities = {
      supportsRestartRequest: true,
      exceptionBreakpointFilters: [
        { filter: "uncaught", label: "Uncaught", default: true, description: "Crashes" },
        { filter: "all", label: "All" },
      ],
    };
    await render();
    await act(async () =>
      useDebuggerStore.getState().actions.setActiveConfigId("workspace-0-attach-node"),
    );
    expect(view().getByText("node-debug --stdio")).toBeTruthy();

    await click(button("Start debugging"));
    expect(io.calls).toContain("start node-debug");
    expect(session()).toMatchObject({ id: "adapter-1", command: "node-debug --stdio" });
    expect(io.calls).toContain("sync adapter-1 0");

    await pauseAt();
    expect(view().getAllByText("Paused on breakpoint").length).toBeGreaterThan(0);
    await click(button("Step over"));
    expect(session()?.status).toBe("running");
    expect(button("Step into").hasAttribute("disabled")).toBe(true);
    await pauseAt();
    await click(button("Step into"));
    await pauseAt();
    await click(button("Step out"));
    expect(io.requests.map(([, command]) => command)).toEqual(["next", "stepIn", "stepOut"]);

    await pauseAt();
    await click(button("Continue debugging"));
    expect(last(io.requests)).toEqual(["adapter-1", "continue", { threadId: 7 }]);
    await click(button("Pause debugging"));
    expect(last(io.requests)?.[1]).toBe("pause");

    await openPanel(/^Breakpoints/);
    expect(panel(/^Breakpoints/).textContent).toContain("1");
    await act(async () => {
      fireEvent.click(view().getByRole("checkbox", { name: /^All exception breakpoint/ }));
    });
    await flush();
    expect(io.calls).toContain("exceptions adapter-1 uncaught,all");

    io.failNext = "exceptions";
    await act(async () => {
      fireEvent.click(view().getByRole("checkbox", { name: /^Uncaught exception breakpoint/ }));
    });
    await flush();
    expect(view().getByText("exceptions failed")).toBeTruthy();

    await click(button("Restart debugging"));
    expect(io.calls).toContain("restart adapter-1");

    await click(button("Stop debugging"));
    expect(io.calls).toContain("disconnect adapter-1");
    expect(session()?.status).toBe("idle");
  });

  it("shows adapter failures and step errors", async () => {
    launchJson([{ name: "Broken", type: "node", adapterCommand: "node-debug" }]);
    await render();
    await act(async () =>
      useDebuggerStore.getState().actions.setActiveConfigId("workspace-0-broken"),
    );
    io.failNext = "start";
    await click(button("Start debugging"));
    expect(view().getByText("start failed")).toBeTruthy();
    expect(session()).toBeNull();

    await click(button("Start debugging"));
    await pauseAt();
    io.failNext = "next";
    await click(button("Step over"));
    expect(view().getByText("next failed")).toBeTruthy();
  });

  it("selects a stack frame, loads its scopes and reveals its source", async () => {
    launchJson([{ name: "Node", type: "node", adapterCommand: "node-debug" }]);
    await render();
    await act(async () =>
      useDebuggerStore.getState().actions.setActiveConfigId("workspace-0-node"),
    );
    await click(button("Start debugging"));
    await act(async () =>
      useDebuggerStore.getState().actions.setStackFrames([
        { id: 1, name: "handler", sourcePath: "/repo/src/server.ts", line: 12, column: 1 },
        { id: 2, name: "native", line: 0, column: 0 },
      ]),
    );
    expect(panel(/^Call Stack/).textContent).toContain("2");
    const lines: Array<{ path: string; line: number }> = [];
    const unsubscribe = onAppEvent("editor:go-to-line", (target) => lines.push(target as never));
    await click(view().getByText("handler").closest("button")!);
    expect(io.requests).toContainEqual(["adapter-1", "scopes", { frameId: 1 }]);
    expect(useDebuggerStore.getState().selectedFrameId).toBe(1);
    expect(opened).toEqual(["/repo/src/server.ts"]);
    expect(lines).toEqual([{ path: "/repo/src/server.ts", line: 12 }]);

    io.failNext = "scopes";
    await click(view().getByText("native").closest("button")!);
    expect(useDebuggerStore.getState().selectedFrameId).toBe(2);
    expect(opened).toHaveLength(1);
    unsubscribe();
  });

  it("lists adapter console output for the session and clears it", async () => {
    await render();
    await act(async () => {
      useDebuggerStore.getState().actions.startSession({
        id: "s1",
        name: "Run",
        configId: "generated-custom",
        command: "run",
        startedAt: 1,
        status: "running",
      });
      useDebuggerStore.getState().actions.recordAdapterOutput({
        sessionId: "s1",
        stream: "stdout",
        data: "listening\n",
      });
      useDebuggerStore.getState().actions.recordAdapterOutput({
        sessionId: "s1",
        stream: "stderr",
        data: "warning\n",
      });
      useDebuggerStore.getState().actions.recordAdapterOutput({
        sessionId: "other",
        stream: "stdout",
        data: "elsewhere",
      });
    });
    await openPanel(/^Console/);
    expect(view().getByText("listening")).toBeTruthy();
    expect(view().getByText("warning")).toBeTruthy();
    expect(view().queryByText("elsewhere")).toBeNull();
    await click(button("Clear console"));
    expect(view().getByText("Adapter output appears here.")).toBeTruthy();
  });

  it("launches and hot-reloads a Java program", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    const info = vi.spyOn(toast, "info").mockImplementation(() => 1);
    openFile("/repo/src/Main.java");
    await render();
    await click(button("Start debugging"));
    expect(io.calls).toContain("java /repo/src/Main.java");
    expect(session()).toMatchObject({ id: "java-1", status: "running" });

    await click(button("Apply Java changes"));
    expect(info).toHaveBeenCalledWith("No changed Java classes were available to reload.");
    io.changedClasses = ["Main", "Util"];
    await click(button("Apply Java changes"));
    expect(success).toHaveBeenCalledWith("Reloaded 2 Java classes.");
    io.failNext = "hotswap";
    await click(button("Apply Java changes"));
    expect(view().getByText("hotswap failed")).toBeTruthy();

    await click(button("Restart debugging"));
    expect(io.calls.filter((call) => call.startsWith("java"))).toHaveLength(2);
    expect(io.calls).toContain("disconnect java-1");

    await act(async () => useDebuggerStore.getState().actions.stopSession());
    io.failNext = "java";
    await click(button("Start debugging"));
    expect(view().getByText("java failed")).toBeTruthy();
  });

  it("closes and toggles full screen from the toolbar and its context menu", async () => {
    await render(true);
    await click(button("Exit full screen Run and Debug"));
    await click(button("Close Run and Debug"));
    expect(fullScreens).toBe(1);
    expect(closes).toBe(1);

    await act(async () => {
      fireEvent.contextMenu(view().getByRole("tablist", { name: "Debugger panels" }), {
        clientX: 5,
        clientY: 5,
      });
    });
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Start Debugging",
      "Pause Debugging",
      "Stop Debugging",
      "Restart Debugging",
      "Toggle Breakpoint at Cursor",
      "Exit Full Screen",
      "Close Run and Debug",
    ]);
    await click(items[5]);
    expect(fullScreens).toBe(2);
  });
});

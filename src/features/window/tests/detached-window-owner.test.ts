// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  windows: [] as Array<{
    label: string;
    destroy: ReturnType<typeof vi.fn>;
    unlisten: ReturnType<typeof vi.fn>;
    destroyed: (() => void) | null;
  }>,
  destroyError: null as unknown,
  onceError: null as unknown,
  setFocus: vi.fn(async () => {}),
  openContent: vi.fn(),
  openSettings: vi.fn(),
  rootFolderPath: "/projects/athas" as string | undefined,
}));

vi.mock("@tauri-apps/api/window", () => ({
  Window: class {
    label: string;
    destroy = vi.fn(async () => {
      if (harness.destroyError) throw harness.destroyError;
    });
    entry: (typeof harness.windows)[number];
    constructor(label: string) {
      this.label = label;
      this.entry = { label, destroy: this.destroy, unlisten: vi.fn(), destroyed: null };
      harness.windows.push(this.entry);
    }
    async once(...args: [string, () => void]) {
      if (harness.onceError) throw harness.onceError;
      this.entry.destroyed = args[1];
      return this.entry.unlisten;
    }
  },
  getCurrentWindow: () => ({ setFocus: harness.setFocus }),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openContent: harness.openContent } }) },
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettings: harness.openSettings }) },
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: harness.rootFolderPath }) },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { commands } from "@/bindings/commands";
import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import { openDetachedWindow } from "../detached/services/detached-window-owner";
import {
  getResourceWindowKey,
  openResourceInDetachedWindow,
  parseResourceWindowPayload,
} from "../detached/services/detached-resource-service";
import {
  openStandaloneContentWindow,
  openTerminalWindow,
} from "../detached/services/standalone-content-service";
import { createAppWindow } from "../services/create-app-window";
import {
  getWindowOpenDiagnostics,
  traceWindowOpenAfterFrame,
} from "../services/window-open-diagnostics";

class FakeBroadcastChannel {
  static channels = new Map<string, FakeBroadcastChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.set(name, this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  close() {
    this.closed = true;
  }
}

function channelFor(id: string) {
  return FakeBroadcastChannel.channels.get(`athas-window-${id}`)!;
}

function receive(id: string, data: unknown) {
  channelFor(id).onmessage?.({ data });
}

function callbacks() {
  return {
    onMessage: vi.fn(),
    onDestroyed: vi.fn(),
    onError: vi.fn(),
    onOpenTimeout: vi.fn(),
  };
}

beforeEach(() => {
  harness.windows = [];
  harness.destroyError = null;
  harness.onceError = null;
  harness.rootFolderPath = "/projects/athas";
  harness.setFocus.mockClear();
  harness.openContent.mockClear();
  harness.openSettings.mockClear();
  vi.mocked(toast.error).mockClear();
  FakeBroadcastChannel.channels.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openDetachedWindow", () => {
  it("creates the native window with the channel and payload", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-1");
    const handle = openDetachedWindow({ kind: "resource", payload: "{}", ...callbacks() });
    await handle.opened;

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        detached: { kind: "resource", channel: handle.id, payload: "{}" },
        content: null,
        path: null,
      }),
    );
    expect(harness.windows.map((window) => window.label)).toEqual(["detached-1"]);
  });

  it("omits the payload when none is given", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-2");
    const handle = openDetachedWindow({ kind: "resource", ...callbacks() });
    await handle.opened;

    expect(create.mock.calls[0][0]?.detached).toEqual({
      kind: "resource",
      channel: handle.id,
      payload: null,
    });
  });

  it("handles workbench and settings requests in the owner window", async () => {
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-3");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;
    const content = { type: "settings" } as OpenContentSpec;

    receive(handle.id, { type: "workbench", content });
    receive(handle.id, { type: "settings", tab: "general", section: "font" });
    receive(handle.id, { type: "ready" });

    expect(harness.openContent).toHaveBeenCalledWith(content);
    expect(harness.openSettings).toHaveBeenCalledWith("general", "font");
    expect(harness.setFocus).toHaveBeenCalledTimes(2);
    expect(options.onMessage).toHaveBeenCalledWith({ type: "ready" }, handle);
  });

  it("releases the channel once when the native window is destroyed", async () => {
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-4");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;
    handle.markInitialized();

    harness.windows[0].destroyed?.();
    harness.windows[0].destroyed?.();
    handle.post({ type: "focus" });
    receive(handle.id, { type: "ready" });

    expect(options.onDestroyed).toHaveBeenCalledOnce();
    expect(options.onDestroyed).toHaveBeenCalledWith({ initialized: true });
    expect(channelFor(handle.id).closed).toBe(true);
    expect(channelFor(handle.id).posted).toEqual([]);
    expect(harness.windows[0].unlisten).toHaveBeenCalledOnce();
    expect(options.onMessage).not.toHaveBeenCalled();
  });

  it("posts messages while the window is alive and destroys it on request", async () => {
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-5");
    const handle = openDetachedWindow({ kind: "resource", ...callbacks() });

    handle.post({ type: "focus" });
    await handle.opened;
    await handle.destroy();

    expect(channelFor(handle.id).posted).toEqual([{ type: "focus" }]);
    expect(harness.windows[0].destroy).toHaveBeenCalledOnce();
  });

  it("tears down a window that never initializes", async () => {
    vi.useFakeTimers();
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-6");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(harness.windows[0].destroy).toHaveBeenCalledOnce();
    expect(options.onOpenTimeout).toHaveBeenCalledOnce();
    expect(channelFor(handle.id).closed).toBe(true);
  });

  it("keeps a window that initialized before the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-7");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;

    handle.markInitialized();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(harness.windows[0].destroy).not.toHaveBeenCalled();
    expect(options.onOpenTimeout).not.toHaveBeenCalled();
  });

  it("reports a failed teardown after the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-8");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;
    harness.destroyError = new Error("already gone");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(options.onError).toHaveBeenCalledWith(harness.destroyError);
    expect(options.onOpenTimeout).not.toHaveBeenCalled();
  });

  it("reports creation failures without leaving a window behind", async () => {
    vi.spyOn(commands, "createAppWindow").mockRejectedValue(new Error("no permission"));
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });

    await expect(handle.opened).resolves.toBeUndefined();

    expect(options.onError).toHaveBeenCalledWith(new Error("no permission"));
    expect(channelFor(handle.id).closed).toBe(true);
  });

  it("destroys a created window when listening for its lifecycle fails", async () => {
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-9");
    harness.onceError = new Error("listen failed");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;

    expect(harness.windows[0].destroy).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledWith(harness.onceError);
  });

  it("reports the close error when the half-created window cannot be destroyed", async () => {
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("detached-10");
    harness.onceError = new Error("listen failed");
    harness.destroyError = new Error("close failed");
    const options = callbacks();
    const handle = openDetachedWindow({ kind: "resource", ...options });
    await handle.opened;

    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledWith(harness.destroyError);
  });
});

describe("detached resource windows", () => {
  const pullRequest = { type: "pullRequest", repoPath: "/repo", prNumber: 12 } as OpenContentSpec;

  it("parses only payloads that carry content", () => {
    expect(parseResourceWindowPayload(null)).toBeNull();
    expect(parseResourceWindowPayload("not json")).toBeNull();
    expect(parseResourceWindowPayload(JSON.stringify({ workspacePath: "/ws" }))).toBeNull();
    expect(parseResourceWindowPayload(JSON.stringify({ content: "text" }))).toBeNull();
    expect(
      parseResourceWindowPayload(JSON.stringify({ workspacePath: "/ws", content: pullRequest })),
    ).toEqual({ workspacePath: "/ws", content: pullRequest });
  });

  it("keys windows by the resource they show", () => {
    expect(getResourceWindowKey(pullRequest)).toBe("pullRequest:/repo:12");
    expect(getResourceWindowKey({ type: "githubIssue", issueNumber: 3 } as OpenContentSpec)).toBe(
      "githubIssue::3",
    );
    expect(
      getResourceWindowKey({
        type: "githubAction",
        repoPath: "/repo",
        url: "https://github.com/o/r/actions/runs/1",
      } as OpenContentSpec),
    ).toBe("githubAction:/repo:https://github.com/o/r/actions/runs/1");
    expect(
      getResourceWindowKey({ type: "githubAction", runId: 9 } as unknown as OpenContentSpec),
    ).toBe("githubAction::9");
    expect(
      getResourceWindowKey({
        type: "githubDelivery",
        repoPath: "/repo",
        kind: "release",
      } as unknown as OpenContentSpec),
    ).toBe("githubDelivery:/repo:release:");
    expect(getResourceWindowKey({ type: "settings" } as OpenContentSpec)).toBe(
      JSON.stringify({ type: "settings" }),
    );
  });

  it("focuses the existing window instead of opening the same resource twice", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("resource-1");

    await openResourceInDetachedWindow(pullRequest);
    await openResourceInDetachedWindow(pullRequest);

    expect(create).toHaveBeenCalledOnce();
    const payload = JSON.parse(create.mock.calls[0][0]?.detached?.payload ?? "null");
    expect(payload).toEqual({ workspacePath: "/projects/athas", content: pullRequest });
    const channel = [...FakeBroadcastChannel.channels.values()][0];
    expect(channel.posted).toEqual([{ type: "focus" }]);

    channel.onmessage?.({ data: { type: "ready" } });
    harness.windows[0].destroyed?.();

    await openResourceInDetachedWindow(pullRequest, "/other");
    expect(create).toHaveBeenCalledTimes(2);
    harness.windows[1].destroyed?.();
  });

  it("lets the resource be opened again after a failed open", async () => {
    vi.spyOn(commands, "createAppWindow")
      .mockRejectedValueOnce("denied")
      .mockResolvedValueOnce("resource-2");
    const issue = { type: "githubIssue", repoPath: "/repo", issueNumber: 5 } as OpenContentSpec;

    await openResourceInDetachedWindow(issue);
    expect(toast.error).toHaveBeenCalledWith("Could not open a new window: denied");

    await openResourceInDetachedWindow(issue);
    expect(harness.windows.map((window) => window.label)).toEqual(["resource-2"]);
    harness.windows[0].destroyed?.();
  });

  it("tells the user when a resource window times out", async () => {
    vi.useFakeTimers();
    vi.spyOn(commands, "createAppWindow").mockResolvedValue("resource-3");
    const action = {
      type: "githubAction",
      repoPath: "/repo",
      runId: 77,
    } as unknown as OpenContentSpec;

    await openResourceInDetachedWindow(action);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(toast.error).toHaveBeenCalledWith("The window did not finish opening.");
  });
});

describe("standalone content windows", () => {
  it("opens content in a new window rooted at the project", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("standalone-1");

    await expect(openStandaloneContentWindow({ type: "settings" } as never)).resolves.toBe(
      "standalone-1",
    );
    expect(create.mock.calls[0][0]).toMatchObject({
      content: { type: "settings" },
      workingDirectory: "/projects/athas",
    });
  });

  it("opens terminals in the project directory unless told otherwise", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("terminal-1");

    await openTerminalWindow();
    await openTerminalWindow({ workingDirectory: "/tmp" } as never);

    expect(create.mock.calls[0][0]?.content).toMatchObject({
      type: "terminal",
      workingDirectory: "/projects/athas",
    });
    expect(create.mock.calls[1][0]?.content).toMatchObject({ workingDirectory: "/tmp" });
  });

  it("returns null and tells the user when the window cannot open", async () => {
    vi.spyOn(commands, "createAppWindow").mockRejectedValue(new Error("limit reached"));

    await expect(openStandaloneContentWindow({ type: "extensions" } as never)).resolves.toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Could not open a new window: Error: limit reached");
  });
});

describe("createAppWindow", () => {
  it("sends null for an empty request and normalizes optional fields", async () => {
    const create = vi.spyOn(commands, "createAppWindow").mockResolvedValue("main-2");

    await expect(createAppWindow()).resolves.toBe("main-2");
    await createAppWindow({ path: "/repo/a.ts", line: 4 });
    await createAppWindow({ path: "/repo", isDirectory: true });
    await createAppWindow({ remoteConnectionId: "ssh-1", remoteConnectionName: "box" });

    expect(create.mock.calls[0][0]).toBeNull();
    expect(create.mock.calls[1][0]).toEqual({
      detached: null,
      content: null,
      workbenchContent: null,
      workingDirectory: null,
      path: "/repo/a.ts",
      isDirectory: null,
      line: 4,
      remoteConnectionId: null,
      remoteConnectionName: null,
    });
    expect(create.mock.calls[2][0]).toMatchObject({ path: "/repo", isDirectory: true });
    expect(create.mock.calls[3][0]).toMatchObject({
      remoteConnectionId: "ssh-1",
      remoteConnectionName: "box",
    });
  });

  it("rethrows native failures", async () => {
    vi.spyOn(commands, "createAppWindow").mockRejectedValue("window limit");

    await expect(createAppWindow({ path: "/a" })).rejects.toBe("window limit");
  });
});

describe("window open diagnostics", () => {
  it("reads the trace parameters the window was opened with", () => {
    window.history.replaceState(
      null,
      "",
      `/?athasWindowTraceId=trace-1&athasWindowCreatedAtMs=${Date.now() - 50}&target=file`,
    );

    const diagnostics = getWindowOpenDiagnostics({ phase: "boot" });

    expect(diagnostics).toMatchObject({ traceId: "trace-1", target: "file", phase: "boot" });
    expect(diagnostics.sinceCreateMs).toBeGreaterThanOrEqual(0);

    window.history.replaceState(null, "", "/?athasWindowCreatedAtMs=soon");
    expect(getWindowOpenDiagnostics()).toMatchObject({ traceId: null, sinceCreateMs: null });
    window.history.replaceState(null, "", "/");
  });

  it("traces once after the next frame or a fallback timer", () => {
    vi.useFakeTimers();
    const getExtra = vi.fn(() => ({ rows: 3 }));

    traceWindowOpenAfterFrame("painted", getExtra);
    vi.advanceTimersByTime(200);
    expect(getExtra).toHaveBeenCalledOnce();

    const cancel = traceWindowOpenAfterFrame("cancelled", getExtra);
    cancel();
    vi.advanceTimersByTime(200);
    expect(getExtra).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const localStorage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
  return localStorage;
});

import { createProjectTabId } from "../services/project-tab-path";
import {
  closeWorkspaceRuntime,
  openWorkspaceRuntime,
  prepareWorkspaceRuntime,
  switchWorkspaceRuntime,
} from "../services/workspace-lifecycle";
import { workspaceRuntimeRegistry } from "../services/workspace-runtime-registry";
import { useWorkspaceTabsStore } from "../stores/workspace-tabs.store";

const idA = createProjectTabId("/edge-a");
const idB = createProjectTabId("/edge-b");

async function openReady(path: string, name: string) {
  return openWorkspaceRuntime({ descriptor: { path, name }, initialize: async () => true });
}

beforeEach(() => {
  storage.clear();
  workspaceRuntimeRegistry.resetForTests();
  useWorkspaceTabsStore.setState({ projectTabs: [] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace lifecycle edge cases", () => {
  it("resumes instead of reinitializing when reopening a ready workspace", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");
    const initialize = vi.fn(async () => true);
    const resume = vi.fn(async () => {});

    await expect(
      openWorkspaceRuntime({ descriptor: { path: "/edge-a", name: "A" }, initialize, resume }),
    ).resolves.toBe(true);

    expect(initialize).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(idA);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(idA);
  });

  it("keeps a known workspace tab when reopening it fails", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");
    workspaceRuntimeRegistry.updateWorkspaceStatus(idA, "error", "earlier failure");

    const opened = await openWorkspaceRuntime({
      descriptor: { path: "/edge-a", name: "A" },
      initialize: async () => {
        throw "disk unavailable";
      },
    });

    expect(opened).toBe(false);
    expect(workspaceRuntimeRegistry.getWorkspace(idA)).toMatchObject({
      status: "error",
      error: "disk unavailable",
    });
    expect(useWorkspaceTabsStore.getState().projectTabs.map((tab) => tab.id)).toContain(idA);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(idB);
  });

  it("does nothing when switching to or closing an unknown workspace", async () => {
    await expect(switchWorkspaceRuntime("missing", { initialize: async () => true })).resolves.toBe(
      false,
    );
    await expect(closeWorkspaceRuntime("missing", { switchTo: async () => true })).resolves.toBe(
      false,
    );
  });

  it("only marks the tab active when switching to the current ready workspace", async () => {
    await openReady("/edge-a", "A");
    const persistCurrent = vi.fn();
    const initialize = vi.fn(async () => true);

    await expect(switchWorkspaceRuntime(idA, { initialize, persistCurrent })).resolves.toBe(true);

    expect(persistCurrent).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });

  it("switches back to the previous workspace when initialization fails", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");
    workspaceRuntimeRegistry.updateWorkspaceStatus(idA, "error");
    const onActivate = vi.fn();

    const switched = await switchWorkspaceRuntime(idA, {
      initialize: async () => false,
      onActivate,
    });

    expect(switched).toBe(false);
    expect(onActivate).toHaveBeenCalledWith(idA);
    expect(workspaceRuntimeRegistry.getWorkspace(idA)).toMatchObject({
      status: "error",
      error: 'Failed to initialize workspace "A".',
    });
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(idB);
    expect(useWorkspaceTabsStore.getState().actions.getActiveProjectTab()?.id).toBe(idB);
  });

  it("stays on the welcome screen when the failed workspace had no predecessor tab", async () => {
    await openReady("/edge-a", "A");
    useWorkspaceTabsStore.getState().actions.addProjectTab("/edge-b", "B");
    workspaceRuntimeRegistry.activateWorkspace({ id: "welcome-like", name: "x" }, "ready");
    useWorkspaceTabsStore.getState().actions.setActiveProjectTab(idA);

    await expect(switchWorkspaceRuntime(idB, { initialize: async () => false })).resolves.toBe(
      false,
    );

    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(idB);
  });

  it("logs a failed background resume", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");

    await switchWorkspaceRuntime(idA, {
      initialize: async () => true,
      resume: async () => {
        throw new Error("lsp crashed");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(console.warn).toHaveBeenCalledWith(
      'Failed to resume workspace services for "/edge-a":',
      new Error("lsp crashed"),
    );
  });

  it("switches to a ready workspace without a resume callback", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");

    await expect(switchWorkspaceRuntime(idA, { initialize: async () => true })).resolves.toBe(true);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(idA);
  });

  it("treats an already ready workspace as prepared", async () => {
    await openReady("/edge-a", "A");
    const initialize = vi.fn(async () => true);

    await expect(
      prepareWorkspaceRuntime({ descriptor: { id: idA, name: "A", path: "/edge-a" }, initialize }),
    ).resolves.toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it("records a failed background preparation", async () => {
    await expect(
      prepareWorkspaceRuntime({
        descriptor: { id: "prep", name: "Prep", path: "/prep" },
        initialize: async () => false,
      }),
    ).resolves.toBe(false);

    expect(workspaceRuntimeRegistry.getWorkspace("prep")).toMatchObject({
      status: "error",
      error: 'Failed to initialize workspace "Prep".',
    });
  });

  it("moves to the next tab after closing the active workspace", async () => {
    await openReady("/edge-a", "A");
    await openReady("/edge-b", "B");
    useWorkspaceTabsStore.getState().actions.setActiveProjectTab(idA);
    workspaceRuntimeRegistry.activateWorkspace({ id: idB, name: "B", path: "/edge-b" }, "ready");
    const persist = vi.fn();
    const dispose = vi.fn(async () => {});
    const switchTo = vi.fn(async () => true);

    await expect(closeWorkspaceRuntime(idB, { persist, dispose, switchTo })).resolves.toBe(true);

    expect(persist).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledWith("/edge-b");
    expect(switchTo).toHaveBeenCalledWith(idA);
  });
});

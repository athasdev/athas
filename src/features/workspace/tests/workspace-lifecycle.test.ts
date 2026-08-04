import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import {
  closeWorkspaceRuntime,
  openWorkspaceRuntime,
  prepareWorkspaceRuntime,
  switchWorkspaceRuntime,
} from "@/features/workspace/services/workspace-lifecycle";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createProjectTabId } from "@/features/window/utils/project-tab-path";

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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  return localStorage;
});

describe("workspace lifecycle", () => {
  beforeEach(() => {
    storage.clear();
    workspaceRuntimeRegistry.resetForTests();
    useWorkspaceTabsStore.setState({ projectTabs: [] });
  });

  it("keeps an initialized workspace live when another workspace opens", async () => {
    const persistCurrent = vi.fn();
    const initializeA = vi.fn(async () => true);
    const initializeB = vi.fn(async () => true);

    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: initializeA,
    });
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: initializeB,
      persistCurrent,
    });

    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");
    expect(initializeA).toHaveBeenCalledOnce();
    expect(initializeB).toHaveBeenCalledOnce();
    expect(persistCurrent).toHaveBeenCalledOnce();
    expect(workspaceRuntimeRegistry.isWorkspaceReady(workspaceAId)).toBe(true);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceBId);
  });

  it("resumes a ready workspace without reinitializing it", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => true,
    });

    const initialize = vi.fn(async () => true);
    const resume = vi.fn(async () => {});
    const workspaceAId = createProjectTabId("/workspace-a");
    const switched = await switchWorkspaceRuntime(workspaceAId, { initialize, resume });

    expect(switched).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resume).toHaveBeenCalledWith(workspaceAId, "/workspace-a");
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceAId);
  });

  it("does not wait for background services when activating a ready workspace", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => true,
    });

    let finishResume: (() => void) | undefined;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishResume = resolve;
        }),
    );
    const workspaceAId = createProjectTabId("/workspace-a");

    await expect(
      switchWorkspaceRuntime(workspaceAId, {
        initialize: async () => true,
        resume,
      }),
    ).resolves.toBe(true);
    expect(resume).not.toHaveBeenCalled();
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceAId);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resume).toHaveBeenCalledOnce();
    finishResume?.();
  });

  it("skips a stale background resume after a newer workspace activates", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => true,
    });
    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");
    const resumeA = vi.fn(async () => {});
    const resumeB = vi.fn(async () => {});

    await switchWorkspaceRuntime(workspaceAId, {
      initialize: async () => true,
      resume: resumeA,
    });
    await switchWorkspaceRuntime(workspaceBId, {
      initialize: async () => true,
      resume: resumeB,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resumeA).not.toHaveBeenCalled();
    expect(resumeB).toHaveBeenCalledOnce();
  });

  it("prepares an inactive workspace without changing the active workspace", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");
    const initialize = vi.fn(async () => true);

    const prepared = await prepareWorkspaceRuntime({
      descriptor: { id: workspaceBId, path: "/workspace-b", name: "B" },
      initialize,
    });

    expect(prepared).toBe(true);
    expect(initialize).toHaveBeenCalledOnce();
    expect(workspaceRuntimeRegistry.isWorkspaceReady(workspaceBId)).toBe(true);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceAId);
  });

  it("reuses an in-flight preparation when its workspace is selected", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    useWorkspaceTabsStore.getState().actions.addProjectTab("/workspace-b", "B");
    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");
    useWorkspaceTabsStore.getState().actions.setActiveProjectTab(workspaceAId);

    let finishInitialization: ((initialized: boolean) => void) | undefined;
    const initialize = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const preparation = prepareWorkspaceRuntime({
      descriptor: { id: workspaceBId, path: "/workspace-b", name: "B" },
      initialize,
    });
    const switching = switchWorkspaceRuntime(workspaceBId, { initialize });

    expect(initialize).toHaveBeenCalledOnce();
    finishInitialization?.(true);

    await expect(Promise.all([preparation, switching])).resolves.toEqual([true, true]);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceBId);
  });

  it("rolls back a failed open without discarding the active runtime", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");

    const opened = await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => false,
    });

    expect(opened).toBe(false);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceAId);
    expect(workspaceRuntimeRegistry.hasWorkspace(workspaceBId)).toBe(false);
    expect(useWorkspaceTabsStore.getState().projectTabs).toHaveLength(1);
  });

  it("does not let a stale failed open replace a newer active workspace", async () => {
    let finishWorkspaceA: ((initialized: boolean) => void) | undefined;
    const workspaceAOpen = openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: () =>
        new Promise<boolean>((resolve) => {
          finishWorkspaceA = resolve;
        }),
    });

    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => true,
    });
    finishWorkspaceA?.(false);
    await workspaceAOpen;

    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(
      createProjectTabId("/workspace-b"),
    );
  });

  it("closes an inactive runtime without disturbing the active workspace", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-b", name: "B" },
      initialize: async () => true,
    });
    const workspaceAId = createProjectTabId("/workspace-a");
    const workspaceBId = createProjectTabId("/workspace-b");
    const dispose = vi.fn(async () => {});
    const switchTo = vi.fn(async () => true);

    const closed = await closeWorkspaceRuntime(workspaceAId, { dispose, switchTo });

    expect(closed).toBe(true);
    expect(dispose).toHaveBeenCalledWith("/workspace-a");
    expect(switchTo).not.toHaveBeenCalled();
    expect(workspaceRuntimeRegistry.hasWorkspace(workspaceAId)).toBe(false);
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe(workspaceBId);
  });

  it("returns to the welcome runtime after closing the final workspace", async () => {
    await openWorkspaceRuntime({
      descriptor: { path: "/workspace-a", name: "A" },
      initialize: async () => true,
    });
    const workspaceAId = createProjectTabId("/workspace-a");
    const showWelcome = vi.fn(async () => {});

    const closed = await closeWorkspaceRuntime(workspaceAId, {
      showWelcome,
      switchTo: async () => true,
    });

    expect(closed).toBe(true);
    expect(showWelcome).toHaveBeenCalledOnce();
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe("workspace:welcome");
  });
});

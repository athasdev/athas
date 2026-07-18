import { createStore } from "zustand/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

describe("WorkspaceRuntimeRegistry", () => {
  let registry: WorkspaceRuntimeRegistry;

  beforeEach(() => {
    registry = new WorkspaceRuntimeRegistry();
    registry.registerStore("counter", () => createStore(() => ({ count: 0 })));
  });

  it("keeps each workspace store isolated and live", () => {
    registry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    registry.getStore<{ count: number }>("counter").setState({ count: 4 });

    registry.activateWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    expect(registry.getStore<{ count: number }>("counter").getState().count).toBe(0);
    registry.getStore<{ count: number }>("counter").setState({ count: 9 });

    registry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    expect(registry.getStore<{ count: number }>("counter").getState().count).toBe(4);
  });

  it("keeps runtime status separate from activation", () => {
    registry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    expect(registry.isWorkspaceReady("workspace-a")).toBe(false);

    registry.updateWorkspaceStatus("workspace-a", "ready");
    expect(registry.isWorkspaceReady("workspace-a")).toBe(true);
  });

  it("removes closed workspace stores", () => {
    registry.ensureWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    registry.getStore<{ count: number }>("counter", "workspace-a").setState({ count: 3 });

    registry.removeWorkspace("workspace-a");
    expect(registry.hasWorkspace("workspace-a")).toBe(false);

    registry.ensureWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    expect(registry.getStore<{ count: number }>("counter", "workspace-a").getState().count).toBe(0);
  });

  it("observes stores in inactive runtimes", () => {
    registry.ensureWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    registry.ensureWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    const workspaceAStore = registry.getStore<{ count: number }>("counter", "workspace-a");
    registry.getStore<{ count: number }>("counter", "workspace-b");
    const listener = vi.fn();
    const unsubscribe = registry.subscribeToStoreKey("counter", listener);

    workspaceAStore.setState({ count: 5 });

    expect(listener).toHaveBeenCalledOnce();
    expect(registry.getExistingStores<{ count: number }>("counter")).toHaveLength(2);
    unsubscribe();
  });
});

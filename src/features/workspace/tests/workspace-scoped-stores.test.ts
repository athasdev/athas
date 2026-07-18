import { beforeEach, describe, expect, it } from "vitest";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useProjectStore } from "@/features/window/stores/project.store";

describe("workspace-scoped stores", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
  });

  it("restores project, tree, and terminal state from the live runtime", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    useProjectStore.getState().setRootFolderPath("/a");
    useFileTreeStore.getState().setExpandedPaths(new Set(["/a/src"]));
    useTerminalTabsStore.getState().dispatch({
      type: "CREATE_TERMINAL",
      payload: { id: "terminal-a", name: "A", currentDirectory: "/a" },
    });

    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    expect(useProjectStore.getState().rootFolderPath).toBeUndefined();
    expect(useFileTreeStore.getState().getExpandedPaths()).toEqual(new Set());
    expect(useTerminalTabsStore.getState().terminals).toEqual([]);

    useProjectStore.getState().setRootFolderPath("/b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });

    expect(useProjectStore.getState().rootFolderPath).toBe("/a");
    expect(useFileTreeStore.getState().getExpandedPaths()).toEqual(new Set(["/a/src"]));
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe("terminal-a");
  });
});

import { enableMapSet } from "immer";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useFileTreeStore } from "../stores/file-explorer-tree.store";

enableMapSet();

describe("file tree store", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
    workspaceRuntimeRegistry.activateWorkspace({ id: "ws", name: "R", path: "/r" });
  });

  it("keeps expanded and selected rows under a renamed directory", () => {
    const { actions } = useFileTreeStore.getState();
    actions.setExpandedPaths(new Set(["/r", "/r/src", "/r/src/nested", "/r/srcx"]));
    actions.selectFile("/r/src/nested/a.ts");

    actions.relocatePath("/r/src", "/r/core");

    const state = useFileTreeStore.getState();
    expect([...state.expandedPaths]).toEqual(["/r", "/r/core", "/r/core/nested", "/r/srcx"]);
    expect(state.actions.isExpanded("/r/core/nested")).toBe(true);
    expect(state.actions.isExpanded("/r/src")).toBe(false);
    expect([...state.selectedFiles]).toEqual(["/r/core/nested/a.ts"]);
  });

  it("leaves state untouched when nothing is under the moved path", () => {
    const { actions } = useFileTreeStore.getState();
    actions.setExpandedPaths(new Set(["/r", "/r/lib"]));
    const before = useFileTreeStore.getState();

    actions.relocatePath("/r/src", "/r/core");

    expect(useFileTreeStore.getState()).toBe(before);
  });
});

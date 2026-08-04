import { beforeEach, describe, expect, it } from "vitest";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useProjectStore } from "@/features/window/stores/project.store";

describe("workspace-scoped stores", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
  });

  it("restores project, tree, and terminal state from the live runtime", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    useProjectStore.getState().actions.setRootFolderPath("/a");
    useSidebarStore.getState().actions.updateActivePath("/a/src/main.ts");
    useFileTreeStore.getState().actions.setExpandedPaths(new Set(["/a/src"]));
    useTerminalTabsStore.getState().actions.dispatch({
      type: "CREATE_TERMINAL",
      payload: { id: "terminal-a", name: "A", currentDirectory: "/a" },
    });

    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    expect(useProjectStore.getState().rootFolderPath).toBeUndefined();
    expect(useSidebarStore.getState().activePath).toBeUndefined();
    expect(useFileTreeStore.getState().actions.getExpandedPaths()).toEqual(new Set());
    expect(useTerminalTabsStore.getState().terminals).toEqual([]);

    useProjectStore.getState().actions.setRootFolderPath("/b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });

    expect(useProjectStore.getState().rootFolderPath).toBe("/a");
    expect(useSidebarStore.getState().activePath).toBe("/a/src/main.ts");
    expect(useFileTreeStore.getState().actions.getExpandedPaths()).toEqual(new Set(["/a/src"]));
    expect(useTerminalTabsStore.getState().activeTerminalId).toBe("terminal-a");
  });

  it("expands each workspace root once without overriding a later collapse", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });

    useFileTreeStore.getState().actions.expandRootOnce("/a");
    expect(useFileTreeStore.getState().actions.isExpanded("/a")).toBe(true);

    useFileTreeStore.getState().actions.setExpandedPaths(new Set());
    useFileTreeStore.getState().actions.expandRootOnce("/a");
    expect(useFileTreeStore.getState().actions.isExpanded("/a")).toBe(false);

    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    useFileTreeStore.getState().actions.expandRootOnce("/b");
    expect(useFileTreeStore.getState().actions.isExpanded("/b")).toBe(true);
  });

  it("keeps delayed buffer actions bound to their owning workspace panes", () => {
    const buffer: EditorContent = {
      id: "shared-buffer",
      type: "editor",
      path: "/a/src/main.ts",
      name: "main.ts",
      content: "",
      savedContent: "",
      isDirty: false,
      isVirtual: false,
      isPinned: false,
      isPreview: true,
      isActive: true,
      tokens: [],
    };

    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-a", name: "A", path: "/a" });
    const workspaceABuffers = useBufferStore.getStore("workspace-a");
    const workspaceAPanes = usePaneStore.getStore("workspace-a");
    workspaceABuffers.setState((state) => ({
      ...state,
      buffers: [buffer],
      activeBufferId: buffer.id,
    }));
    workspaceAPanes.getState().actions.addBufferToPane(ROOT_PANE_ID, buffer.id);

    workspaceRuntimeRegistry.activateWorkspace({ id: "workspace-b", name: "B", path: "/b" });
    const workspaceBPanes = usePaneStore.getStore("workspace-b");
    workspaceBPanes.getState().actions.addBufferToPane(ROOT_PANE_ID, buffer.id);

    workspaceABuffers.getState().actions.handleTabPin(buffer.id);

    expect(workspaceAPanes.getState().actions.getPaneById(ROOT_PANE_ID)?.pinnedBufferIds).toContain(
      buffer.id,
    );
    expect(
      workspaceBPanes.getState().actions.getPaneById(ROOT_PANE_ID)?.pinnedBufferIds,
    ).not.toContain(buffer.id);
  });
});

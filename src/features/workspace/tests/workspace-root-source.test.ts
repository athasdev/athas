// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { isPathInsideTreeEntry } from "@/features/file-system/services/file-tree-utils";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import {
  createProjectTabId,
  normalizeProjectTabPath,
  normalizeWorkspaceRootPath,
} from "@/features/workspace/services/project-tab-path";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));

describe("workspace root path normalization", () => {
  it.each([
    ["/Users/me//project/", "/Users/me/project"],
    ["///Users/me/project", "/Users/me/project"],
    ["  /a/b///  ", "/a/b"],
    ["/", "/"],
    ["C:\\Users\\me\\\\project\\", "C:\\Users\\me\\project"],
    ["C:\\", "C:\\"],
    ["\\\\server\\share\\\\dir\\", "\\\\server\\share\\dir"],
    ["\\\\server\\share\\", "\\\\server\\share"],
    ["//server/share", "//server/share"],
    ["//server//share/dir/", "//server/share/dir"],
    ["\\\\wsl$\\Ubuntu\\home\\", "\\\\wsl$\\Ubuntu\\home"],
    ["//", "/"],
    ["remote://connection-1/", "remote://connection-1/"],
    ["remote://connection-1//home//me/", "remote://connection-1/home/me"],
    ["wsl://Ubuntu//home/me/", "wsl://Ubuntu/home/me"],
    ["wsl://Ubuntu/", "wsl://Ubuntu/"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeWorkspaceRootPath(input)).toBe(expected);
  });

  it("keeps project tab paths and ids stable for paths that were already normalized", () => {
    expect(normalizeProjectTabPath("/a/b/")).toBe("/a/b");
    expect(normalizeProjectTabPath("remote://connection-1/")).toBe("remote://connection-1");
    expect(createProjectTabId("/a//b/")).toBe(createProjectTabId("/a/b"));
  });

  it("lets tree prefix checks match children of a root opened with a repeated separator", () => {
    const root = normalizeWorkspaceRootPath("/work//repo/");
    expect(isPathInsideTreeEntry("/work/repo/src/main.ts", root)).toBe(true);
  });
});

describe("workspace root ownership", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
  });

  it("stores the root once, normalized, with the primary workspace folder", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A", path: "/a" });
    useProjectStore.getState().actions.setRootFolderPath("/a//repo/", "repo");

    expect(useProjectStore.getState().rootFolderPath).toBe("/a/repo");
    expect(useProjectStore.getState().workspaceFolders).toEqual([
      { path: "/a/repo", name: "repo", isPrimary: true },
    ]);
    expect(useFileSystemStore.getState()).not.toHaveProperty("rootFolderPath");
    expect(useFileSystemStore.getState()).not.toHaveProperty("workspaceFolders");

    useProjectStore.getState().actions.setRootFolderPath(undefined);
    expect(useProjectStore.getState().rootFolderPath).toBeUndefined();
    expect(useProjectStore.getState().workspaceFolders).toEqual([]);
  });

  it("updates every active-workspace reader when the workspace switches", () => {
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A", path: "/a" });
    useProjectStore.getState().actions.setRootFolderPath("/a");
    useProjectStore.getStore("b").getState().actions.setRootFolderPath("/b");
    useProjectStore
      .getStore("b")
      .getState()
      .actions.setWorkspaceFolders([
        { path: "/b", name: "b", isPrimary: true },
        { path: "/extra", name: "extra" },
      ]);

    const seenRoots: Array<string | undefined> = [];
    const unsubscribe = useProjectStore.subscribe((state) => seenRoots.push(state.rootFolderPath));

    workspaceRuntimeRegistry.activateWorkspace({ id: "b", name: "B", path: "/b" });
    expect(useProjectStore.getState().rootFolderPath).toBe("/b");
    expect(useProjectStore.getState().workspaceFolders.map((folder) => folder.path)).toEqual([
      "/b",
      "/extra",
    ]);

    workspaceRuntimeRegistry.activateWorkspace({ id: "welcome", name: "Files" });
    expect(useProjectStore.getState().rootFolderPath).toBeUndefined();

    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A", path: "/a" });
    expect(useProjectStore.getState().rootFolderPath).toBe("/a");
    unsubscribe();

    expect(seenRoots).toEqual(["/b", undefined, "/a"]);
  });
});

describe("persisted project tabs", () => {
  it("normalizes saved tab paths and ids when they are read back", async () => {
    const storageKey = useWorkspaceTabsStore.persist.getOptions().name!;
    const tab = (path: string, isActive: boolean) => ({
      id: `legacy-${path}`,
      name: "repo",
      path,
      isActive,
      lastOpened: 1,
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          projectTabs: [
            tab("/work//repo", false),
            tab("/work/repo//", true),
            { ...tab("/other", false), id: createProjectTabId("/other") },
          ],
        },
        version: 1,
      }),
    );

    await useWorkspaceTabsStore.persist.rehydrate();

    expect(useWorkspaceTabsStore.getState().projectTabs).toEqual([
      expect.objectContaining({
        id: createProjectTabId("/work/repo"),
        path: "/work/repo",
        isActive: true,
      }),
      expect.objectContaining({ id: createProjectTabId("/other"), path: "/other" }),
    ]);
    localStorage.removeItem(storageKey);
    useWorkspaceTabsStore.setState({ projectTabs: [] });
  });
});

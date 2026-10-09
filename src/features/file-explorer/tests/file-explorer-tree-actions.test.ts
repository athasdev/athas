import { enableMapSet } from "immer";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useFileTreeStore } from "../stores/file-explorer-tree.store";

enableMapSet();

const tree = () => useFileTreeStore.getState();
const actions = () => tree().actions;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
});

describe("file explorer tree state", () => {
  it("expands a workspace root only the first time it appears", () => {
    actions().expandRootOnce("/repo");
    actions().toggleFolder("/repo");
    actions().expandRootOnce("/repo");

    expect(actions().isExpanded("/repo")).toBe(false);
    expect(tree().initializedRootPaths).toEqual(["/repo"]);
  });

  it("selects one entry, or toggles entries when multi-selecting", () => {
    actions().selectFile("/repo/a.ts");
    actions().selectFile("/repo/b.ts", true);
    actions().selectFile("/repo/c.ts", true);
    actions().selectFile("/repo/b.ts", true);

    expect([...tree().selectedFiles]).toEqual(["/repo/a.ts", "/repo/c.ts"]);
    expect(actions().isSelected("/repo/b.ts")).toBe(false);

    actions().selectFile("/repo/d.ts");
    expect([...tree().selectedFiles]).toEqual(["/repo/d.ts"]);

    actions().clearSelection();
    expect(tree().selectedFiles.size).toBe(0);
  });

  it("expands every ancestor of a path on POSIX and Windows", () => {
    actions().expandToPath("/repo/src/lib/util.ts");
    actions().expandToPath("C:\\work\\src\\main.rs");

    expect([...actions().getExpandedPaths()].filter(Boolean)).toEqual([
      "/repo",
      "/repo/src",
      "/repo/src/lib",
      "C:",
      "C:\\work",
      "C:\\work\\src",
    ]);
  });

  it("expands every nested folder of a tree", () => {
    const files: FileEntry[] = [
      {
        name: "repo",
        path: "/repo",
        isDir: true,
        children: [
          { name: "src", path: "/repo/src", isDir: true, children: [] },
          { name: "docs", path: "/repo/docs", isDir: true },
          { name: "a.ts", path: "/repo/a.ts", isDir: false },
        ],
      },
    ];

    actions().expandAll(files);

    expect([...tree().expandedFolders].sort()).toEqual(["/repo", "/repo/docs", "/repo/src"]);
  });
});

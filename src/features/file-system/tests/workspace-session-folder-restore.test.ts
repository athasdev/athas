import { describe, expect, it, vi } from "vite-plus/test";
import { restoreWorkspaceSessionFolders } from "../services/workspace-session-folder-restore";

describe("workspace session folder restore", () => {
  it("loads only saved roots that are not already present", async () => {
    const readRootEntry = vi.fn(async (path: string) => ({
      name: path.split("/").pop() ?? path,
      path,
      isDir: true,
      children: [],
    }));

    const restored = await restoreWorkspaceSessionFolders({
      projectPath: "/workspace/main",
      workspaceFolders: [
        { path: "/workspace/main", name: "main", isPrimary: true },
        { path: "/workspace/existing", name: "existing" },
        { path: "/workspace/extra", name: "extra" },
      ],
      currentRootPaths: new Set(["/workspace/main", "/workspace/existing"]),
      readRootEntry,
    });

    expect(readRootEntry).toHaveBeenCalledOnce();
    expect(readRootEntry).toHaveBeenCalledWith("/workspace/extra");
    expect(restored.rootEntries).toEqual([
      {
        name: "extra",
        path: "/workspace/extra",
        isDir: true,
        children: [],
      },
    ]);
    expect(restored.workspaceFolders.map((folder) => folder.path)).toEqual([
      "/workspace/main",
      "/workspace/existing",
      "/workspace/extra",
    ]);
  });

  it("drops unreadable saved roots and reports their error", async () => {
    const failure = new Error("missing");
    const onFolderError = vi.fn();

    const restored = await restoreWorkspaceSessionFolders({
      projectPath: "/workspace/main",
      workspaceFolders: [
        { path: "/workspace/main", name: "main", isPrimary: true },
        { path: "/workspace/missing", name: "missing" },
      ],
      currentRootPaths: new Set(["/workspace/main"]),
      readRootEntry: vi.fn().mockRejectedValue(failure),
      onFolderError,
    });

    expect(restored.rootEntries).toEqual([]);
    expect(restored.workspaceFolders).toEqual([
      { path: "/workspace/main", name: "main", isPrimary: true },
    ]);
    expect(onFolderError).toHaveBeenCalledWith(
      { path: "/workspace/missing", name: "missing", isPrimary: false },
      failure,
    );
  });
});

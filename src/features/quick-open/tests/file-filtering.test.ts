import { describe, expect, it } from "vite-plus/test";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import { filterQuickOpenRecentFiles } from "../utils/file-filtering";

function recent(path: string, overrides: Partial<RecentFile> = {}): RecentFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    lastAccessed: "2026-01-01T00:00:00.000Z",
    accessCount: 1,
    frecencyScore: 1,
    workspacePath: "/workspace",
    ...overrides,
  };
}

describe("quick-open recent files", () => {
  const indexed = new Set(["/workspace/src/a.ts"]);

  it("removes files from other workspaces without matching sibling root prefixes", () => {
    const files = [
      recent("/workspace/src/a.ts"),
      recent("/other/b.ts", { workspacePath: "/other" }),
      recent("/workspace-other/c.ts", { workspacePath: "/workspace-other" }),
    ];
    expect(filterQuickOpenRecentFiles(files, "/workspace", indexed, false)).toEqual([files[0]]);
  });

  it("keeps unindexed entries until the workspace index is loaded", () => {
    const files = [recent("/workspace/src/a.ts"), recent("/workspace/deleted.ts")];
    expect(filterQuickOpenRecentFiles(files, "/workspace", indexed, false)).toEqual(files);
    expect(filterQuickOpenRecentFiles(files, "/workspace", indexed, true)).toEqual([files[0]]);
  });

  it("keeps external files associated with the workspace even after indexing", () => {
    const files = [recent("/outside/a.ts", { external: true })];
    expect(filterQuickOpenRecentFiles(files, "/workspace", indexed, true)).toEqual(files);
  });

  it("recognizes files under the root even without recorded workspace metadata", () => {
    const files = [recent("/workspace/src/a.ts", { workspacePath: null })];
    expect(filterQuickOpenRecentFiles(files, "/workspace", indexed, true)).toEqual(files);
  });

  it("still applies a loaded index when no root folder is open", () => {
    const files = [recent("/anywhere/x.ts"), recent("/workspace/src/a.ts")];
    expect(filterQuickOpenRecentFiles(files, null, indexed, true)).toEqual([files[1]]);
  });
});

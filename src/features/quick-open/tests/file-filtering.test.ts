import { describe, expect, it } from "vite-plus/test";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import { filterQuickOpenRecentFiles, shouldIgnoreFile } from "../utils/file-filtering";

function makeRecentFile(path: string, overrides: Partial<RecentFile> = {}): RecentFile {
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

describe("shouldIgnoreFile", () => {
  it("ignores files inside dependency and build directories", () => {
    expect(shouldIgnoreFile("/workspace/node_modules/lib/index.js")).toBe(true);
    expect(shouldIgnoreFile("/workspace/dist/bundle.min.js")).toBe(true);
    expect(shouldIgnoreFile("src/target/debug/app.rs")).toBe(true);
  });

  it("ignores lockfiles and OS metadata files", () => {
    expect(shouldIgnoreFile("/workspace/package-lock.json")).toBe(true);
    expect(shouldIgnoreFile("/workspace/Cargo.lock")).toBe(true);
    expect(shouldIgnoreFile("/workspace/.DS_Store")).toBe(true);
  });

  it("keeps regular source files", () => {
    expect(shouldIgnoreFile("/workspace/src/main.ts")).toBe(false);
    expect(shouldIgnoreFile("/workspace/README.md")).toBe(false);
  });
});

describe("filterQuickOpenRecentFiles", () => {
  const indexedPaths = new Set(["/workspace/src/a.ts", "/workspace/src/b.ts"]);

  it("drops recent files from other workspaces", () => {
    const filtered = filterQuickOpenRecentFiles(
      [
        makeRecentFile("/workspace/src/a.ts"),
        makeRecentFile("/other/src/c.ts", { workspacePath: "/other" }),
      ],
      "/workspace",
      indexedPaths,
      true,
    );

    expect(filtered.map((file) => file.path)).toEqual(["/workspace/src/a.ts"]);
  });

  it("keeps files that exist in the workspace index", () => {
    const filtered = filterQuickOpenRecentFiles(
      [makeRecentFile("/workspace/src/a.ts"), makeRecentFile("/workspace/src/deleted.ts")],
      "/workspace",
      indexedPaths,
      true,
    );

    expect(filtered.map((file) => file.path)).toEqual(["/workspace/src/a.ts"]);
  });

  it("keeps external and unindexed files while the file tree has not loaded", () => {
    const filtered = filterQuickOpenRecentFiles(
      [
        makeRecentFile("/outside/d.ts", { external: true }),
        makeRecentFile("/workspace/src/unindexed.ts"),
      ],
      "/workspace",
      indexedPaths,
      false,
    );

    expect(filtered).toHaveLength(2);
  });

  it("keeps indexed files when no root folder is open", () => {
    const filtered = filterQuickOpenRecentFiles(
      [
        makeRecentFile("/anywhere/x.ts", { workspacePath: null }),
        makeRecentFile("/workspace/src/a.ts"),
      ],
      null,
      indexedPaths,
      true,
    );

    // Without a root folder everything belongs to the workspace,
    // but loaded indexes still gate which files exist.
    expect(filtered.map((file) => file.path)).toEqual(["/workspace/src/a.ts"]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import { filterQuickOpenRecentFiles } from "./file-filtering";

const recentFile = (path: string, overrides: Partial<RecentFile> = {}): RecentFile => ({
  path,
  name: path.split("/").pop() ?? path,
  lastAccessed: "2026-07-24T00:00:00.000Z",
  accessCount: 1,
  frecencyScore: 1,
  workspacePath: "/workspace",
  external: false,
  ...overrides,
});

describe("filterQuickOpenRecentFiles", () => {
  it("hides workspace files that are no longer in the project index", () => {
    const files = [recentFile("/workspace/package.json"), recentFile("/workspace/bunfig.toml")];

    expect(
      filterQuickOpenRecentFiles(files, "/workspace", new Set(["/workspace/package.json"]), true),
    ).toEqual([files[0]]);
  });

  it("keeps current-workspace history until the project file list is ready", () => {
    const file = recentFile("/workspace/bunfig.toml");

    expect(filterQuickOpenRecentFiles([file], "/workspace", new Set(), false)).toEqual([file]);
  });

  it("keeps explicitly external files associated with the current workspace", () => {
    const file = recentFile("/outside/notes.md", { external: true });

    expect(filterQuickOpenRecentFiles([file], "/workspace", new Set(), true)).toEqual([file]);
  });

  it("excludes recent files from a different workspace", () => {
    const file = recentFile("/other/file.ts", { workspacePath: "/other" });

    expect(filterQuickOpenRecentFiles([file], "/workspace", new Set(), false)).toEqual([]);
  });
});

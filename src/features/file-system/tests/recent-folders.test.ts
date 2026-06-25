import { describe, expect, it } from "vite-plus/test";
import {
  limitRecentFolders,
  MAX_RECENT_PROJECTS,
  toggleRecentFolderPinned,
  uniqueRecentFolderImports,
  updateRecentFolderMetadata,
  upsertRecentFolder,
} from "../utils/recent-folders";

describe("recent folder helpers", () => {
  it("upserts metadata and keeps most recent projects first", () => {
    const folders = upsertRecentFolder(
      upsertRecentFolder([], "/workspace/old", { lastOpenedAt: 1000 }),
      "/workspace/new",
      {
        activeProjectTabId: "tab-new",
        customIcon: "/workspace/new/icon.png",
        importSourceId: "cursor",
        importSourceName: "Cursor",
        lastOpenedAt: 2000,
      },
    );

    expect(folders.map((folder) => folder.path)).toEqual(["/workspace/new", "/workspace/old"]);
    expect(folders[0]).toMatchObject({
      name: "new",
      activeProjectTabId: "tab-new",
      customIcon: "/workspace/new/icon.png",
      importSourceId: "cursor",
      importSourceName: "Cursor",
      missing: false,
    });
  });

  it("keeps pinned recent projects ahead of newer unpinned projects", () => {
    const folders = toggleRecentFolderPinned(
      [
        {
          name: "old",
          path: "/workspace/old",
          lastOpened: "old",
          lastOpenedAt: 1000,
        },
        {
          name: "new",
          path: "/workspace/new",
          lastOpened: "new",
          lastOpenedAt: 2000,
        },
      ],
      "/workspace/old",
    );

    expect(folders.map((folder) => folder.path)).toEqual(["/workspace/old", "/workspace/new"]);
    expect(folders[0].pinned).toBe(true);
  });

  it("preserves pinned projects while limiting unpinned projects", () => {
    const folders = Array.from({ length: MAX_RECENT_PROJECTS + 2 }, (_, index) => ({
      name: `project-${index}`,
      path: `/workspace/project-${index}`,
      lastOpened: String(index),
      lastOpenedAt: index,
      pinned: index === 0,
    }));

    const limited = limitRecentFolders(folders);

    expect(limited).toHaveLength(MAX_RECENT_PROJECTS + 1);
    expect(limited[0].path).toBe("/workspace/project-0");
    expect(limited.some((folder) => folder.path === "/workspace/project-1")).toBe(false);
  });

  it("marks a recent project as missing without changing its order", () => {
    const folders = updateRecentFolderMetadata(
      [
        {
          name: "one",
          path: "/workspace/one",
          lastOpened: "one",
          lastOpenedAt: 1000,
        },
        {
          name: "two",
          path: "/workspace/two",
          lastOpened: "two",
          lastOpenedAt: 500,
        },
      ],
      "/workspace/two",
      { missing: true },
    );

    expect(folders.map((folder) => folder.path)).toEqual(["/workspace/one", "/workspace/two"]);
    expect(folders[1].missing).toBe(true);
  });

  it("deduplicates recent project imports while preserving first source metadata", () => {
    const folders = uniqueRecentFolderImports([
      { path: "/workspace/one", sourceId: "cursor", sourceName: "Cursor" },
      { path: "/workspace/two", sourceId: "vscode", sourceName: "VS Code" },
      { path: "/workspace/one", sourceId: "duplicate", sourceName: "Duplicate" },
    ]);

    expect(folders.map((folder) => folder.path)).toEqual(["/workspace/one", "/workspace/two"]);
    expect(folders[0]).toMatchObject({
      sourceId: "cursor",
      sourceName: "Cursor",
    });
  });
});

import { describe, expect, it } from "vite-plus/test";
import type { GitFile } from "../types/git.types";
import { buildGitFolderTree, buildGitStatusPresentation } from "../utils/git-status-model";

const file = (path: string, status: GitFile["status"], staged = false): GitFile => ({
  path,
  status,
  staged,
});

describe("git status model", () => {
  it("keeps staged and unstaged operations while displaying one row per path", () => {
    const unstaged = file("src/app.ts", "modified");
    const staged = file("src/app.ts", "modified", true);
    const model = buildGitStatusPresentation([unstaged, staged]);

    expect(model.stagedFiles).toEqual([staged]);
    expect(model.unstagedFiles).toEqual([unstaged]);
    expect(model.visibleFiles).toEqual([staged]);
    expect(model.hasStagedDiffableFiles).toBe(true);
    expect(model.hasUnstagedDiffableFiles).toBe(true);
  });

  it("builds sorted folders with descendant staging state", () => {
    const tree = buildGitFolderTree([
      file("src/z.ts", "modified", true),
      file("src/components/a.ts", "added", true),
      file("docs/readme.md", "modified"),
    ]);

    expect(tree.nodes.map((node) => node.path)).toEqual(["docs", "src"]);
    expect(tree.folderStateById.get("branch:src")?.areAllDescendantFilesStaged).toBe(true);
    expect(tree.folderStateById.get("branch:docs")?.areAllDescendantFilesStaged).toBe(false);
    expect(tree.folderStateById.get("branch:src")?.descendantFilePaths).toEqual([
      "src/components/a.ts",
      "src/z.ts",
    ]);
  });
});

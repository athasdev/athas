import { describe, expect, test } from "vite-plus/test";
import type { FileEntry } from "@/features/file-system/types/app";
import type { GitFile, GitStatus } from "@/features/git/types/git-types";
import {
  createFileTreeGitStatusLookup,
  getFileTreeEntryGitStatusDecoration,
  getFileTreeGitStatusDecoration,
} from "./file-tree-git-status";

const gitFile = (path: string, status: GitFile["status"], staged = false): GitFile => ({
  path,
  status,
  staged,
});

const fileEntry = (path: string, isDir = false): FileEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  isDir,
});

describe("getFileTreeGitStatusDecoration", () => {
  test("maps modified files to staged and unstaged colors", () => {
    expect(getFileTreeGitStatusDecoration(gitFile("src/app.ts", "modified"))).toEqual({
      colorClassName: "text-git-modified",
      label: "Modified",
    });

    expect(getFileTreeGitStatusDecoration(gitFile("src/app.ts", "modified", true))).toEqual({
      colorClassName: "text-git-modified-staged",
      label: "Modified (staged)",
    });
  });

  test("maps non-modified statuses to their file tree colors", () => {
    expect(getFileTreeGitStatusDecoration(gitFile("added.ts", "added"))).toEqual({
      colorClassName: "text-git-added",
      label: "Added",
    });
    expect(getFileTreeGitStatusDecoration(gitFile("deleted.ts", "deleted"))).toEqual({
      colorClassName: "text-git-deleted",
      label: "Deleted",
    });
    expect(getFileTreeGitStatusDecoration(gitFile("untracked.ts", "untracked"))).toEqual({
      colorClassName: "text-git-untracked",
      label: "Untracked",
    });
    expect(getFileTreeGitStatusDecoration(gitFile("renamed.ts", "renamed"))).toEqual({
      colorClassName: "text-git-renamed",
      label: "Renamed",
    });
  });
});

describe("file tree git status lookup", () => {
  test("keeps exact file status and inherited directory status separate", () => {
    const gitStatus: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [gitFile("src/app.ts", "modified"), gitFile("docs/readme.md", "added")],
    };

    const lookup = createFileTreeGitStatusLookup(gitStatus);

    expect(
      getFileTreeEntryGitStatusDecoration(fileEntry("/workspace/src/app.ts"), "/workspace", lookup),
    ).toEqual({ colorClassName: "text-git-modified", label: "Modified" });

    expect(
      getFileTreeEntryGitStatusDecoration(fileEntry("/workspace/src", true), "/workspace", lookup),
    ).toEqual({ colorClassName: "text-git-modified", label: "Modified" });

    expect(
      getFileTreeEntryGitStatusDecoration(fileEntry("/workspace/docs", true), "/workspace", lookup),
    ).toEqual({ colorClassName: "text-git-added", label: "Added" });
  });

  test("uses the highest priority descendant status for directories", () => {
    const lookup = createFileTreeGitStatusLookup({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [
        gitFile("src/new.ts", "untracked"),
        gitFile("src/renamed.ts", "renamed"),
        gitFile("src/deleted.ts", "deleted"),
        gitFile("src/modified.ts", "modified"),
      ],
    });

    expect(
      getFileTreeEntryGitStatusDecoration(fileEntry("/workspace/src", true), "/workspace", lookup),
    ).toEqual({ colorClassName: "text-git-deleted", label: "Deleted" });
  });

  test("returns null without a root path or matching status", () => {
    const lookup = createFileTreeGitStatusLookup({
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [gitFile("src/app.ts", "modified")],
    });

    expect(
      getFileTreeEntryGitStatusDecoration(fileEntry("/workspace/src/app.ts"), undefined, lookup),
    ).toBeNull();
    expect(
      getFileTreeEntryGitStatusDecoration(
        fileEntry("/workspace/src/other.ts"),
        "/workspace",
        lookup,
      ),
    ).toBeNull();
  });
});

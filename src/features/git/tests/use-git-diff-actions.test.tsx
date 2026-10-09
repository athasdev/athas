// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { invalidateGitDiffData } from "../api/git-diff-api";
import { useGitDiffActions } from "../hooks/use-git-diff-actions";
import type { WorkingTreeDiffEntry } from "../services/working-tree-diff-loader";
import type { GitCommit, GitFile } from "../types/git.types";

const mocks = vi.hoisted(() => ({
  openBuffer: vi.fn(),
  showAlertDialog: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/ui/dialog", () => ({ showAlertDialog: mocks.showAlertDialog }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [],
      actions: { openBuffer: mocks.openBuffer, updateBuffer: vi.fn() },
    }),
  },
}));

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function diff(filePath: string, extra: Record<string, unknown> = {}) {
  return {
    file_path: filePath,
    old_path: filePath,
    new_path: filePath,
    is_binary: false,
    is_deleted: false,
    is_new: false,
    is_renamed: false,
    lines: [
      { line_type: "added", content: "a" },
      { line_type: "removed", content: "b" },
      { line_type: "added", content: "c" },
    ],
    ...extra,
  };
}

const modified: GitFile = { path: "src/a.ts", status: "modified", staged: false };
const untracked: GitFile = { path: "new.ts", status: "untracked", staged: false };
const commit = {
  hash: "abcdef1234",
  message: "Fix it",
  description: "Longer text",
  author: "Ada",
  email: "ada@example.com",
  date: "2026-01-01",
} as GitCommit;

type Options = Parameters<typeof useGitDiffActions>[0];

let root: Root;
let container: HTMLDivElement;

function renderActions(overrides: Partial<Options> = {}) {
  const result = { current: undefined as unknown as ReturnType<typeof useGitDiffActions> };
  const options: Options = {
    activeRepoPath: "/repo",
    onFileSelect: vi.fn(),
    gitFileByPath: new Map([
      [modified.path, modified],
      [untracked.path, untracked],
    ]),
    workingTreeDiffEntriesByScope: {
      all: [["unstaged:src/a.ts", modified]] as WorkingTreeDiffEntry[],
      unstaged: [["unstaged:src/a.ts", modified]] as WorkingTreeDiffEntry[],
      staged: [],
    },
    commitByHash: new Map([[commit.hash, commit]]),
    currentBranch: "feature",
    ...overrides,
  };
  function Harness() {
    result.current = useGitDiffActions(options);
    return null;
  }
  act(() => root.render(<Harness />));
  return { result, options };
}

function openedBuffers() {
  return mocks.openBuffer.mock.calls.map(([path, name, , , , , , data]) => ({ path, name, data }));
}

describe("useGitDiffActions", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    clearRepositoryDiscoveryCache();
    invalidateGitDiffData();
    mocks.openBuffer.mockReset();
    mocks.openBuffer.mockReturnValue("buffer-1");
    mocks.showAlertDialog.mockClear();
    handlers = {
      git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
      git_diff_file: ({ filePath }) => diff(filePath),
      git_commit_diff: () => [diff("src/a.ts"), diff("src/b.ts", { new_path: "src/b2.ts" })],
      git_stash_diff: () => [diff("stashed.ts")],
      git_ref_diff: () => [diff("ref.ts")],
    };
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command, args) => {
      const handler = handlers[command];
      return handler ? handler((args ?? {}) as Record<string, any>) : null;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  describe("openOriginalFile", () => {
    it("opens the new side of a rename with quotes stripped", async () => {
      const { result, options } = renderActions();

      await act(() => result.current.openOriginalFile('old.ts -> "new name.ts"'));

      expect(options.onFileSelect).toHaveBeenCalledWith("/repo/new name.ts", false);
    });

    it("does nothing without a repository or a file handler", async () => {
      const onFileSelect = vi.fn();
      const { result } = renderActions({ activeRepoPath: null, onFileSelect });
      await act(() => result.current.openOriginalFile("a.ts"));
      expect(onFileSelect).not.toHaveBeenCalled();

      const second = renderActions({ onFileSelect: undefined });
      await act(() => second.result.current.openOriginalFile("a.ts"));
      expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    });

    it("shows an alert when the file handler throws", async () => {
      const { result } = renderActions({
        onFileSelect: () => {
          throw new Error("no editor");
        },
      });

      await act(() => result.current.openOriginalFile("a.ts"));

      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        expect.stringContaining("Failed to open file a.ts"),
        "Open File",
      );
    });
  });

  describe("viewFileDiff", () => {
    it("opens a single-file working tree diff for a tracked file", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewFileDiff("src/a.ts"));

      expect(mockInvoke).toHaveBeenCalledWith("git_diff_file", {
        repoPath: "/repo",
        filePath: "src/a.ts",
        staged: false,
      });
      const [opened] = openedBuffers();
      expect(opened.path).toBe("diff://working-tree/all-files");
      expect(opened.name).toBe("Uncommitted Changes");
      expect(opened.data).toMatchObject({ repoPath: "/repo" });
    });

    it("uses the old side of a rename for unstaged diffs and the new side for staged diffs", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewFileDiff("old.ts -> new.ts"));
      await act(() => result.current.viewFileDiff("old.ts -> new.ts", true));

      const requested = mockInvoke.mock.calls
        .filter(([command]) => command === "git_diff_file")
        .map(([, args]) => args);
      expect(requested).toEqual([
        { repoPath: "/repo", filePath: "old.ts", staged: false },
        { repoPath: "/repo", filePath: "new.ts", staged: true },
      ]);
    });

    it("opens untracked files directly instead of diffing them", async () => {
      const { result, options } = renderActions();

      await act(() => result.current.viewFileDiff("new.ts"));

      expect(options.onFileSelect).toHaveBeenCalledWith("/repo/new.ts", false);
      expect(mockInvoke).not.toHaveBeenCalledWith("git_diff_file", expect.anything());
    });

    it("falls back to the file when the diff has no text, image or binary changes", async () => {
      handlers.git_diff_file = ({ filePath }) => diff(filePath, { lines: [] });
      const { result, options } = renderActions();

      await act(() => result.current.viewFileDiff("src/a.ts"));

      expect(options.onFileSelect).toHaveBeenCalledWith("/repo/src/a.ts", false);
      expect(mocks.openBuffer).not.toHaveBeenCalled();
    });

    it("still opens binary diffs without lines", async () => {
      handlers.git_diff_file = ({ filePath }) => diff(filePath, { lines: [], is_binary: true });
      const { result } = renderActions();

      await act(() => result.current.viewFileDiff("src/a.ts"));

      expect(mocks.openBuffer).toHaveBeenCalledTimes(1);
    });

    it("alerts when opening the diff buffer fails", async () => {
      mocks.openBuffer.mockImplementation(() => {
        throw new Error("buffer limit");
      });
      const { result } = renderActions();

      await act(() => result.current.viewFileDiff("src/a.ts"));

      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        expect.stringContaining("Failed to get diff for src/a.ts"),
        "Git Diff",
      );
    });
  });

  describe("viewWorkingTreeDiff", () => {
    it("opens the requested scope progressively", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewWorkingTreeDiff("unstaged"));

      const [opened] = openedBuffers();
      expect(opened.path).toBe("diff://working-tree/unstaged");
      expect(opened.name).toBe("Unstaged Changes");
      expect(opened.data).toMatchObject({ isLoading: true, indexingProgress: { total: 1 } });
    });

    it("alerts instead of opening an empty scope", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewWorkingTreeDiff("staged"));

      expect(mocks.openBuffer).not.toHaveBeenCalled();
      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        "No staged changes with diffs.",
        "Git Diff",
      );
    });
  });

  describe("viewCommitDiff", () => {
    it("opens all files of a commit with its metadata and totals", async () => {
      const { result } = renderActions();
      let returned: unknown;

      await act(async () => {
        returned = await result.current.viewCommitDiff(commit.hash);
      });

      expect(returned).toHaveLength(2);
      const [opened] = openedBuffers();
      expect(opened.path).toBe("diff://commit/abcdef1234/all-files");
      expect(opened.name).toBe("Commit abcdef1 (2 files)");
      expect(opened.data).toMatchObject({
        title: "Commit abcdef1",
        repoPath: "/repo",
        commitHash: commit.hash,
        fileKeys: ["src/a.ts", "src/b.ts"],
        totalFiles: 2,
        totalAdditions: 4,
        totalDeletions: 2,
        commitMessage: "Fix it",
        commitDescription: "Longer text",
        commitAuthor: "Ada",
        commitEmail: "ada@example.com",
        commitDate: "2026-01-01",
      });
      expect(result.current.isLoadingCommitDiff).toBe(false);
    });

    it("preselects a file matched by its renamed path", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewCommitDiff(commit.hash, "src/b2.ts"));

      expect(openedBuffers()[0].data).toMatchObject({
        initiallyExpandedFileKey: "src/b.ts",
        selectedFileKey: "src/b.ts",
        selectedFilePath: "src/b2.ts",
      });
    });

    it("alerts and returns null for an empty commit", async () => {
      handlers.git_commit_diff = () => [];
      const { result } = renderActions();
      let returned: unknown = "unset";

      await act(async () => {
        returned = await result.current.viewCommitDiff("deadbeef", "x.ts");
      });

      expect(returned).toBeNull();
      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        "No changes in this commit for file x.ts.",
        "Git Diff",
      );
    });

    it("returns null without a repository", async () => {
      const { result } = renderActions({ activeRepoPath: null });
      let returned: unknown = "unset";

      await act(async () => {
        returned = await result.current.viewCommitDiff("abc");
      });

      expect(returned).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("alerts when the buffer cannot be opened", async () => {
      mocks.openBuffer.mockImplementation(() => {
        throw new Error("nope");
      });
      const { result } = renderActions();

      await act(() => result.current.viewCommitDiff(commit.hash));

      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to get diff for commit ${commit.hash}`),
        "Git Diff",
      );
      expect(result.current.isLoadingCommitDiff).toBe(false);
    });
  });

  describe("stash, tag and branch comparisons", () => {
    it("opens a stash diff", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewStashDiff(1));

      expect(mockInvoke).toHaveBeenCalledWith("git_stash_diff", {
        repoPath: "/repo",
        stashIndex: 1,
      });
      expect(openedBuffers()[0]).toMatchObject({
        path: "diff://stash/1/all-files",
        name: "Stash @{1} (1 files)",
        data: { commitHash: "stash@{1}", totalFiles: 1 },
      });
    });

    it("alerts for an empty stash and for stash failures", async () => {
      handlers.git_stash_diff = () => [];
      const { result } = renderActions();
      await act(() => result.current.viewStashDiff(0));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        "No changes in this stash.",
        "Git Diff",
      );

      handlers.git_stash_diff = () => [diff("x.ts")];
      mocks.openBuffer.mockImplementation(() => {
        throw new Error("x");
      });
      await act(() => result.current.viewStashDiff(5));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        expect.stringContaining("Failed to get diff for stash@{5}"),
        "Git Diff",
      );
    });

    it("compares two tags under an encoded virtual path", async () => {
      const { result } = renderActions();

      await act(() => result.current.viewTagComparison("v1", "v2", "v1 → v2"));

      expect(mockInvoke).toHaveBeenCalledWith("git_ref_diff", {
        repoPath: "/repo",
        baseRef: "v1",
        targetRef: "v2",
      });
      expect(openedBuffers()[0]).toMatchObject({
        path: `diff://tag/${encodeURIComponent("v1 → v2")}/all-files`,
        data: { commitHash: "v1..v2", title: "v1 → v2" },
      });
    });

    it("alerts when tags have no differences or fail to compare", async () => {
      handlers.git_ref_diff = () => [];
      const { result } = renderActions();
      await act(() => result.current.viewTagComparison("v1", "v2", "t"));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        "No changes between v1 and v2.",
        "Git Diff",
      );

      handlers.git_ref_diff = () => [diff("x.ts")];
      mocks.openBuffer.mockImplementation(() => {
        throw new Error("x");
      });
      await act(() => result.current.viewTagComparison("v3", "v4", "t2"));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        expect.stringContaining("Failed to compare v3 and v4"),
        "Git Diff",
      );
    });

    it("compares a base branch against the current branch and notifies the caller", async () => {
      const onBranchDiffOpened = vi.fn();
      const { result } = renderActions({ onBranchDiffOpened });

      await act(() => result.current.viewBranchDiff("main"));

      expect(mockInvoke).toHaveBeenCalledWith("git_ref_diff", {
        repoPath: "/repo",
        baseRef: "main",
        targetRef: "feature",
      });
      expect(openedBuffers()[0]).toMatchObject({
        path: `diff://branch/${encodeURIComponent("main..feature")}/all-files`,
        name: "main..feature (1 files)",
      });
      expect(onBranchDiffOpened).toHaveBeenCalledTimes(1);
      expect(result.current.isLoadingBranchDiff).toBe(false);
    });

    it("compares against HEAD when the branch is unknown and skips comparing a branch with itself", async () => {
      const { result } = renderActions({ currentBranch: undefined });

      await act(() => result.current.viewBranchDiff("HEAD"));
      expect(mockInvoke).not.toHaveBeenCalled();

      await act(() => result.current.viewBranchDiff("main"));
      expect(mockInvoke).toHaveBeenCalledWith("git_ref_diff", {
        repoPath: "/repo",
        baseRef: "main",
        targetRef: "HEAD",
      });
    });

    it("alerts when branches have no differences or the comparison fails", async () => {
      const onBranchDiffOpened = vi.fn();
      handlers.git_ref_diff = () => [];
      const { result } = renderActions({ onBranchDiffOpened });
      await act(() => result.current.viewBranchDiff("main"));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        "No changes between main and feature.",
        "Git Diff",
      );

      handlers.git_ref_diff = () => [diff("x.ts")];
      mocks.openBuffer.mockImplementation(() => {
        throw new Error("x");
      });
      await act(() => result.current.viewBranchDiff("dev"));
      expect(mocks.showAlertDialog).toHaveBeenLastCalledWith(
        expect.stringContaining("Failed to compare dev and feature"),
        "Git Diff",
      );
      expect(onBranchDiffOpened).not.toHaveBeenCalled();
    });

    it("does nothing without a repository", async () => {
      const { result } = renderActions({ activeRepoPath: null });

      await act(async () => {
        await result.current.viewFileDiff("a.ts");
        await result.current.viewWorkingTreeDiff();
        await result.current.viewStashDiff(0);
        await result.current.viewTagComparison("a", "b", "t");
        await result.current.viewBranchDiff("main");
      });

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(mocks.openBuffer).not.toHaveBeenCalled();
    });
  });
});

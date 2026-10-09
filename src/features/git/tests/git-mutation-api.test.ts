import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../api/git-branches-api";
import { commitChanges, getGitLog } from "../api/git-commits-api";
import {
  addRemote,
  fetchChanges,
  getRemotes,
  pullChanges,
  pushChanges,
  removeRemote,
} from "../api/git-remotes-api";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { applyStash, createStash, dropStash, getStashes, popStash } from "../api/git-stash-api";
import {
  discardAllChanges,
  discardFileChanges,
  initRepository,
  setFilesStaged,
  stageAllFiles,
  stageFile,
  stageHunk,
  unstageAllFiles,
  unstageFile,
  unstageHunk,
} from "../api/git-status-api";
import {
  checkoutTag,
  createTag,
  deleteRemoteTag,
  deleteTag,
  getTags,
  pushTag,
} from "../api/git-tags-api";
import { subscribeToGitChanges, type GitChange } from "../events/git-events";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, unknown>) => unknown;

let handlers: Record<string, Handler>;
let changes: GitChange[];
let unsubscribe: () => void;

function route(overrides: Record<string, Handler> = {}) {
  handlers = {
    git_discover_repo: ({ path }) => ((path as string).startsWith("/repo") ? "/repo" : null),
    ...overrides,
  };
}

function nativeCalls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

describe("git mutation and read apis", () => {
  beforeEach(() => {
    clearRepositoryDiscoveryCache();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command, args) => {
      const handler = handlers[command];
      if (!handler) return null;
      return handler((args ?? {}) as Record<string, unknown>);
    });
    route();
    changes = [];
    unsubscribe = subscribeToGitChanges((change) => changes.push(change));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  describe("reads", () => {
    it("resolves nested paths to the repository root before reading", async () => {
      route({
        git_branches: () => ["main", "dev"],
        git_get_remotes: () => [{ name: "origin", url: "git@x" }],
        git_get_stashes: () => [{ index: 0, message: "wip" }],
        git_get_tags: () => [{ name: "v1" }],
        git_log: ({ limit, skip }) => [{ hash: `${limit}-${skip}` }],
      });

      await expect(getBranches("/repo/src")).resolves.toEqual(["main", "dev"]);
      await expect(getRemotes("/repo/src")).resolves.toEqual([{ name: "origin", url: "git@x" }]);
      await expect(getStashes("/repo/src")).resolves.toEqual([{ index: 0, message: "wip" }]);
      await expect(getTags("/repo/src")).resolves.toEqual([{ name: "v1" }]);
      await expect(getGitLog("/repo/src", 20, 40)).resolves.toEqual([{ hash: "20-40" }]);

      for (const command of [
        "git_branches",
        "git_get_remotes",
        "git_get_stashes",
        "git_get_tags",
      ]) {
        expect(nativeCalls(command)).toEqual([{ repoPath: "/repo" }]);
      }
      expect(nativeCalls("git_discover_repo")).toEqual([{ path: "/repo/src" }]);
    });

    it("returns empty results outside a repository without issuing reads", async () => {
      await expect(getBranches("/elsewhere")).resolves.toEqual([]);
      await expect(getRemotes("/elsewhere")).resolves.toEqual([]);
      await expect(getStashes("/elsewhere")).resolves.toEqual([]);
      await expect(getTags("/elsewhere")).resolves.toEqual([]);
      await expect(getGitLog("/elsewhere")).resolves.toEqual([]);

      expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual(["git_discover_repo"]);
    });

    it("returns empty results when native reads fail and only logs unexpected errors", async () => {
      const failing = () => {
        throw new Error("boom");
      };
      route({
        git_branches: failing,
        git_get_remotes: () => {
          throw "fatal: not a git repository";
        },
        git_get_stashes: failing,
        git_get_tags: failing,
        git_log: failing,
      });

      await expect(getBranches("/repo")).resolves.toEqual([]);
      await expect(getRemotes("/repo")).resolves.toEqual([]);
      await expect(getStashes("/repo")).resolves.toEqual([]);
      await expect(getTags("/repo")).resolves.toEqual([]);
      await expect(getGitLog("/repo")).resolves.toEqual([]);

      const logged = vi.mocked(console.error).mock.calls.map(([message]) => message);
      expect(logged).toEqual([
        "Failed to get branches:",
        "Failed to get stashes:",
        "Failed to get tags:",
        "Failed to get git log:",
      ]);
    });
  });

  describe("branches", () => {
    it("checks out a branch and announces the change only on success", async () => {
      route({
        git_checkout: ({ branchName }) =>
          branchName === "dev"
            ? { success: true, hasChanges: false, message: "" }
            : { success: false, hasChanges: true, message: "Local changes" },
      });

      await expect(checkoutBranch("/repo/a", "dev")).resolves.toMatchObject({ success: true });
      await expect(checkoutBranch("/repo/a", "main")).resolves.toEqual({
        success: false,
        hasChanges: true,
        message: "Local changes",
      });

      expect(nativeCalls("git_checkout")).toEqual([
        { repoPath: "/repo", branchName: "dev" },
        { repoPath: "/repo", branchName: "main" },
      ]);
      expect(changes).toEqual([
        {
          repoPath: "/repo",
          scopes: ["working-tree", "history", "refs"],
          source: "checkout-branch",
        },
      ]);
    });

    it("reports a failed checkout outside a repository", async () => {
      await expect(checkoutBranch("/elsewhere", "dev")).resolves.toEqual({
        success: false,
        hasChanges: false,
        message: "Failed to checkout branch",
      });
      expect(nativeCalls("git_checkout")).toEqual([]);
    });

    it("creates and deletes branches", async () => {
      await expect(createBranch("/repo", "feature/x")).resolves.toBe(true);
      await expect(createBranch("/repo", "feature/y", "dev")).resolves.toBe(true);
      await expect(deleteBranch("/repo", "feature/x")).resolves.toBe(true);

      expect(nativeCalls("git_create_branch")).toEqual([
        { repoPath: "/repo", branchName: "feature/x", fromBranch: null },
        { repoPath: "/repo", branchName: "feature/y", fromBranch: "dev" },
      ]);
      expect(nativeCalls("git_delete_branch")).toEqual([
        { repoPath: "/repo", branchName: "feature/x" },
      ]);
      expect(changes.map((change) => [change.source, change.scopes])).toEqual([
        ["create-branch", ["working-tree", "history", "refs"]],
        ["create-branch", ["working-tree", "history", "refs"]],
        ["delete-branch", ["refs"]],
      ]);
    });

    it("returns false and emits nothing when branch writes fail", async () => {
      route({
        git_create_branch: () => {
          throw new Error("exists");
        },
        git_delete_branch: () => {
          throw new Error("not merged");
        },
      });

      await expect(createBranch("/repo", "x")).resolves.toBe(false);
      await expect(deleteBranch("/repo", "x")).resolves.toBe(false);
      expect(changes).toEqual([]);
    });
  });

  describe("commits and remotes", () => {
    it("commits with the message and announces history changes", async () => {
      await expect(commitChanges("/repo", "Fix bug")).resolves.toBe(true);

      expect(nativeCalls("git_commit")).toEqual([{ repoPath: "/repo", message: "Fix bug" }]);
      expect(changes).toEqual([
        { repoPath: "/repo", scopes: ["working-tree", "history", "refs"], source: "commit" },
      ]);
    });

    it("returns false when a commit fails", async () => {
      route({
        git_commit: () => {
          throw new Error("nothing to commit");
        },
      });

      await expect(commitChanges("/repo", "msg")).resolves.toBe(false);
      await expect(commitChanges("/elsewhere", "msg")).resolves.toBe(false);
      expect(changes).toEqual([]);
    });

    it("pushes, pulls and fetches with default remotes", async () => {
      await expect(pushChanges("/repo")).resolves.toEqual({ success: true });
      await expect(pushChanges("/repo", "dev", "upstream")).resolves.toEqual({ success: true });
      await expect(pullChanges("/repo")).resolves.toEqual({ success: true });
      await expect(fetchChanges("/repo")).resolves.toEqual({ success: true });
      await expect(fetchChanges("/repo", "upstream")).resolves.toEqual({ success: true });

      expect(nativeCalls("git_push")).toEqual([
        { repoPath: "/repo", branch: null, remote: "origin" },
        { repoPath: "/repo", branch: "dev", remote: "upstream" },
      ]);
      expect(nativeCalls("git_pull")).toEqual([
        { repoPath: "/repo", branch: null, remote: "origin" },
      ]);
      expect(nativeCalls("git_fetch")).toEqual([
        { repoPath: "/repo", remote: null },
        { repoPath: "/repo", remote: "upstream" },
      ]);
      expect(changes.map((change) => change.source)).toEqual([
        "push",
        "push",
        "pull",
        "fetch",
        "fetch",
      ]);
      expect(changes[2].scopes).toEqual(["working-tree", "history", "refs", "remotes"]);
    });

    it("surfaces remote errors as messages", async () => {
      route({
        git_push: () => {
          throw new Error("rejected: non-fast-forward");
        },
        git_pull: () => {
          throw "merge conflict";
        },
        git_fetch: () => {
          throw new Error("network down");
        },
      });

      await expect(pushChanges("/repo")).resolves.toEqual({
        success: false,
        error: "rejected: non-fast-forward",
      });
      await expect(pullChanges("/repo")).resolves.toEqual({
        success: false,
        error: "merge conflict",
      });
      await expect(fetchChanges("/repo")).resolves.toEqual({
        success: false,
        error: "network down",
      });
      expect(changes).toEqual([]);
    });

    it("adds and removes remotes", async () => {
      await expect(addRemote("/repo", "upstream", "https://example.com/r.git")).resolves.toBe(true);
      await expect(removeRemote("/repo", "upstream")).resolves.toBe(true);

      expect(nativeCalls("git_add_remote")).toEqual([
        { repoPath: "/repo", name: "upstream", url: "https://example.com/r.git" },
      ]);
      expect(nativeCalls("git_remove_remote")).toEqual([{ repoPath: "/repo", name: "upstream" }]);
      expect(changes.map((change) => [change.source, change.scopes])).toEqual([
        ["add-remote", ["remotes"]],
        ["remove-remote", ["remotes"]],
      ]);

      route({
        git_add_remote: () => {
          throw new Error("exists");
        },
        git_remove_remote: () => {
          throw new Error("missing");
        },
      });
      await expect(addRemote("/repo", "upstream", "u")).resolves.toBe(false);
      await expect(removeRemote("/repo", "upstream")).resolves.toBe(false);
    });
  });

  describe("stashes", () => {
    it("issues stash commands with defaults and announces the affected scopes", async () => {
      await expect(createStash("/repo")).resolves.toBe(true);
      await expect(createStash("/repo", "wip", true, ["a.ts"])).resolves.toBe(true);
      await expect(applyStash("/repo", 1)).resolves.toBe(true);
      await expect(popStash("/repo")).resolves.toBe(true);
      await expect(popStash("/repo", 2)).resolves.toBe(true);
      await expect(dropStash("/repo", 3)).resolves.toBe(true);

      expect(nativeCalls("git_create_stash")).toEqual([
        { repoPath: "/repo", message: null, includeUntracked: false, files: null },
        { repoPath: "/repo", message: "wip", includeUntracked: true, files: ["a.ts"] },
      ]);
      expect(nativeCalls("git_apply_stash")).toEqual([{ repoPath: "/repo", stashIndex: 1 }]);
      expect(nativeCalls("git_pop_stash")).toEqual([
        { repoPath: "/repo", stashIndex: null },
        { repoPath: "/repo", stashIndex: 2 },
      ]);
      expect(nativeCalls("git_drop_stash")).toEqual([{ repoPath: "/repo", stashIndex: 3 }]);
      expect(changes.map((change) => [change.source, change.scopes])).toEqual([
        ["create-stash", ["working-tree", "stashes"]],
        ["create-stash", ["working-tree", "stashes"]],
        ["apply-stash", ["working-tree"]],
        ["pop-stash", ["working-tree", "stashes"]],
        ["pop-stash", ["working-tree", "stashes"]],
        ["drop-stash", ["stashes"]],
      ]);
    });

    it("returns false for every stash write that fails", async () => {
      const failing = () => {
        throw new Error("conflict");
      };
      route({
        git_create_stash: failing,
        git_apply_stash: failing,
        git_pop_stash: failing,
        git_drop_stash: failing,
      });

      await expect(createStash("/repo")).resolves.toBe(false);
      await expect(applyStash("/repo", 0)).resolves.toBe(false);
      await expect(popStash("/repo")).resolves.toBe(false);
      await expect(dropStash("/repo", 0)).resolves.toBe(false);
      expect(changes).toEqual([]);
    });
  });

  describe("tags", () => {
    it("creates, pushes, checks out and deletes tags", async () => {
      route({
        git_checkout_tag: () => ({ success: true, hasChanges: false, message: "" }),
      });

      await expect(createTag("/repo", "v1")).resolves.toBe(true);
      await expect(createTag("/repo", "v2", "Release", "abc123", true)).resolves.toBe(true);
      await expect(pushTag("/repo", "v1", "origin")).resolves.toEqual({ success: true });
      await expect(deleteRemoteTag("/repo", "v1", "origin")).resolves.toEqual({ success: true });
      await expect(checkoutTag("/repo", "v1")).resolves.toMatchObject({ success: true });
      await expect(deleteTag("/repo", "v1")).resolves.toBe(true);

      expect(nativeCalls("git_create_tag")).toEqual([
        { repoPath: "/repo", name: "v1", message: null, commit: null, signed: false },
        { repoPath: "/repo", name: "v2", message: "Release", commit: "abc123", signed: true },
      ]);
      expect(nativeCalls("git_push_tag")).toEqual([
        { repoPath: "/repo", name: "v1", remote: "origin" },
      ]);
      expect(changes.map((change) => change.source)).toEqual([
        "create-tag",
        "create-tag",
        "push-tag",
        "delete-remote-tag",
        "checkout-tag",
        "delete-tag",
      ]);
    });

    it("does not announce a tag checkout that was refused", async () => {
      route({
        git_checkout_tag: () => ({ success: false, hasChanges: true, message: "dirty" }),
      });

      await expect(checkoutTag("/repo", "v1")).resolves.toMatchObject({ success: false });
      expect(changes).toEqual([]);
    });

    it("turns tag failures into results", async () => {
      const failing = () => {
        throw new Error("denied");
      };
      route({
        git_create_tag: failing,
        git_push_tag: failing,
        git_delete_remote_tag: () => {
          throw "remote rejected";
        },
        git_checkout_tag: failing,
        git_delete_tag: failing,
      });

      await expect(createTag("/repo", "v1")).resolves.toBe(false);
      await expect(pushTag("/repo", "v1", "origin")).resolves.toEqual({
        success: false,
        error: "denied",
      });
      await expect(deleteRemoteTag("/repo", "v1", "origin")).resolves.toEqual({
        success: false,
        error: "remote rejected",
      });
      await expect(checkoutTag("/repo", "v1")).resolves.toEqual({
        success: false,
        hasChanges: false,
        message: "denied",
      });
      await expect(deleteTag("/repo", "v1")).resolves.toBe(false);
      expect(changes).toEqual([]);
    });
  });

  describe("working tree", () => {
    it("stages and unstages single files", async () => {
      await expect(stageFile("/repo", "a.ts")).resolves.toBe(true);
      await expect(unstageFile("/repo", "a.ts")).resolves.toBe(true);

      expect(nativeCalls("git_add")).toEqual([{ repoPath: "/repo", filePath: "a.ts" }]);
      expect(nativeCalls("git_reset")).toEqual([{ repoPath: "/repo", filePath: "a.ts" }]);
      expect(changes).toEqual([
        { repoPath: "/repo", filePath: "a.ts", scopes: ["working-tree"], source: "stage-file" },
        { repoPath: "/repo", filePath: "a.ts", scopes: ["working-tree"], source: "unstage-file" },
      ]);
    });

    it("stages a batch, deduplicates paths and reports per-file results", async () => {
      route({
        git_add: ({ filePath }) => {
          if (filePath === "bad.ts") throw new Error("pathspec did not match");
          return null;
        },
      });

      const results = await setFilesStaged("/repo", ["a.ts", "bad.ts", "a.ts"], true);

      expect(Object.fromEntries(results)).toEqual({ "a.ts": true, "bad.ts": false });
      expect(nativeCalls("git_add")).toHaveLength(2);
      expect(changes).toEqual([
        { repoPath: "/repo", scopes: ["working-tree"], source: "stage-files" },
      ]);
    });

    it("unstages a batch through reset", async () => {
      const results = await setFilesStaged("/repo", ["a.ts", "b.ts"], false);

      expect(Object.fromEntries(results)).toEqual({ "a.ts": true, "b.ts": true });
      expect(nativeCalls("git_reset").map((args) => args?.filePath)).toEqual(["a.ts", "b.ts"]);
      expect(changes[0].source).toBe("unstage-files");
    });

    it("does nothing for an empty batch and fails every path outside a repository", async () => {
      await expect(setFilesStaged("/repo", [], true)).resolves.toEqual(new Map());
      expect(mockInvoke).not.toHaveBeenCalled();

      const results = await setFilesStaged("/elsewhere", ["a.ts", "b.ts"], true);
      expect(Object.fromEntries(results)).toEqual({ "a.ts": false, "b.ts": false });
      expect(changes).toEqual([]);
    });

    it("does not announce a batch where every path failed", async () => {
      route({
        git_reset: () => {
          throw new Error("nope");
        },
      });

      const results = await setFilesStaged("/repo", ["a.ts"], false);

      expect(results.get("a.ts")).toBe(false);
      expect(changes).toEqual([]);
    });

    it("stages and unstages everything", async () => {
      await expect(stageAllFiles("/repo")).resolves.toBe(true);
      await expect(unstageAllFiles("/repo")).resolves.toBe(true);

      expect(nativeCalls("git_add_all")).toEqual([{ repoPath: "/repo" }]);
      expect(nativeCalls("git_reset_all")).toEqual([{ repoPath: "/repo" }]);
      expect(changes.map((change) => change.source)).toEqual(["stage-all", "unstage-all"]);
    });

    it("sends hunks with explicit null line numbers", async () => {
      const hunk = {
        file_path: "a.ts",
        lines: [
          { line_type: "added", content: "x" },
          { line_type: "context", content: "y", old_line_number: 1, new_line_number: 2 },
        ],
      } as never;

      await expect(stageHunk("/repo", hunk)).resolves.toBe(true);
      await expect(unstageHunk("/repo", hunk)).resolves.toBe(true);

      const [staged] = nativeCalls("git_stage_hunk");
      expect(staged).toEqual({
        repoPath: "/repo",
        hunk: {
          file_path: "a.ts",
          lines: [
            { line_type: "added", content: "x", old_line_number: null, new_line_number: null },
            { line_type: "context", content: "y", old_line_number: 1, new_line_number: 2 },
          ],
        },
      });
      expect(nativeCalls("git_unstage_hunk")).toHaveLength(1);
      expect(changes.map((change) => [change.source, change.filePath])).toEqual([
        ["stage-hunk", "a.ts"],
        ["unstage-hunk", "a.ts"],
      ]);
    });

    it("discards file and repository changes", async () => {
      await expect(discardFileChanges("/repo", "a.ts")).resolves.toBe(true);
      await expect(discardAllChanges("/repo")).resolves.toBe(true);

      expect(nativeCalls("git_discard_file_changes")).toEqual([
        { repoPath: "/repo", filePath: "a.ts" },
      ]);
      expect(nativeCalls("git_discard_all_changes")).toEqual([{ repoPath: "/repo" }]);
      expect(changes.map((change) => change.source)).toEqual(["discard-file", "discard-all"]);
    });

    it("initializes a repository at the given path without discovery", async () => {
      await expect(initRepository("/new")).resolves.toBe(true);

      expect(mockInvoke.mock.calls).toEqual([["git_init", { repoPath: "/new" }]]);
      expect(changes).toEqual([
        {
          repoPath: "/new",
          scopes: ["repository", "working-tree", "refs"],
          source: "initialize-repository",
        },
      ]);
    });

    it("returns false for working tree writes that fail", async () => {
      const failing = () => {
        throw new Error("locked");
      };
      route({
        git_add: failing,
        git_reset: failing,
        git_add_all: failing,
        git_reset_all: failing,
        git_stage_hunk: failing,
        git_unstage_hunk: failing,
        git_discard_file_changes: failing,
        git_discard_all_changes: failing,
        git_init: failing,
      });
      const hunk = { file_path: "a.ts", lines: [] } as never;

      const results = await Promise.all([
        stageFile("/repo", "a.ts"),
        unstageFile("/repo", "a.ts"),
        stageAllFiles("/repo"),
        unstageAllFiles("/repo"),
        stageHunk("/repo", hunk),
        unstageHunk("/repo", hunk),
        discardFileChanges("/repo", "a.ts"),
        discardAllChanges("/repo"),
        initRepository("/repo"),
      ]);

      expect(results.every((result) => result === false)).toBe(true);
      expect(changes).toEqual([]);
    });
  });
});

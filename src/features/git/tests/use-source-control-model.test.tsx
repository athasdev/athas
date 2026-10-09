// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { clearRepositoryDiscoveryCache } from "../api/git-repo-api";
import { invalidateGitDiffData } from "../api/git-diff-api";
import { useGitBlameStore } from "../stores/git-blame.store";
import { useGitStore } from "../stores/git.store";
import { useSourceControlModel, type SourceControlModel } from "../stream/use-source-control-model";
import type { GitFile } from "../types/git.types";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async (): Promise<string | null> => "feature/new"),
  alert: vi.fn(async () => {}),
  openBuffer: vi.fn(() => "buffer"),
  requestInlineEdit: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/ui/dialog", () => ({
  showConfirmDialog: mocks.confirm,
  showPromptDialog: mocks.prompt,
  showAlertDialog: mocks.alert,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [],
      actions: { openBuffer: mocks.openBuffer, updateBuffer: vi.fn() },
    }),
  },
}));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => {
  class InlineEditError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { InlineEditError, requestInlineEdit: mocks.requestInlineEdit };
});
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return { useSettingsStore: create(() => ({ settings: {} })) };
});

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;
let statusFiles: GitFile[];
let statusExtras: Record<string, unknown>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

let root: Root;
const onFileSelect = vi.fn();

async function settle() {
  await act(async () => {
    for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderModel() {
  const result = { current: undefined as unknown as SourceControlModel };
  function Harness() {
    result.current = useSourceControlModel({ repoPath: "/repo", onFileSelect, isActive: true });
    return null;
  }
  await act(async () => root.render(<Harness />));
  await settle();
  return result;
}

function setSettings(settings: Record<string, unknown>) {
  useSettingsStore.setState({
    settings: {
      showUntrackedFiles: true,
      aiAutocompleteModelId: "model-1",
      openDiffOnClick: true,
      autoRefreshGitStatus: true,
      ...settings,
    },
  } as never);
}

describe("useSourceControlModel", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    workspaceRuntimeRegistry.resetForTests();
    clearRepositoryDiscoveryCache();
    invalidateGitDiffData();
    setSettings({});
    for (const fn of Object.values(mocks.toast)) fn.mockReset();
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(true);
    mocks.prompt.mockReset();
    mocks.prompt.mockResolvedValue("feature/new");
    mocks.alert.mockClear();
    mocks.openBuffer.mockClear();
    mocks.requestInlineEdit.mockReset();
    onFileSelect.mockReset();
    statusFiles = [
      { path: "src/app.ts", status: "modified", staged: true },
      { path: "src/app.ts", status: "modified", staged: false },
      { path: "README.md", status: "modified", staged: false },
      { path: "notes/todo.txt", status: "untracked", staged: false },
    ];
    statusExtras = { ahead: 0, behind: 0 };
    handlers = {
      git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
      git_status: () => ({ branch: "main", files: statusFiles, ...statusExtras }),
      git_log: () => [{ hash: "c1", message: "first" }],
      git_branches: () => ["main", "dev"],
      git_get_stashes: () => [],
      git_status_diff_stats: () => [
        { file_path: "src/app.ts", staged: true, additions: 3, deletions: 1 },
        { file_path: "README.md", staged: false, additions: 2, deletions: 0 },
      ],
      git_checkout: () => ({ success: true, hasChanges: false, message: "" }),
      git_diff_file: ({ filePath }) => ({
        file_path: filePath,
        lines: [{ line_type: "added", content: "x" }],
        is_new: false,
        is_deleted: false,
        is_renamed: false,
      }),
    };
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command, args) => {
      const handler = handlers[command];
      return handler ? handler((args ?? {}) as Record<string, any>) : null;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  describe("derived state", () => {
    it("splits files into staged and unstaged with per-file diff stats", async () => {
      const model = await renderModel();

      expect(model.current.repoName).toBe("repo");
      expect(model.current.branch).toBe("main");
      expect(model.current.hasStatus).toBe(true);
      expect(model.current.staged.map((file) => file.key)).toEqual(["staged:src/app.ts"]);
      expect(model.current.unstaged.map((file) => file.key)).toEqual([
        "unstaged:src/app.ts",
        "unstaged:README.md",
        "unstaged:notes/todo.txt",
      ]);
      expect(model.current.staged[0]).toMatchObject({
        name: "app.ts",
        dir: "src",
        additions: 3,
        deletions: 1,
      });
      expect(model.current.unstaged[1]).toMatchObject({ name: "README.md", dir: "" });
      expect(model.current.totals).toEqual({ additions: 5, deletions: 1 });
      expect(model.current.commits).toEqual([{ hash: "c1", message: "first" }]);
      expect(model.current.branches).toEqual(["main", "dev"]);
    });

    it("hides untracked files when the setting is off", async () => {
      setSettings({ showUntrackedFiles: false });
      const model = await renderModel();

      expect(model.current.files.map((file) => file.path)).not.toContain("notes/todo.txt");
    });

    it.each([
      [{ ahead: 0, behind: 2 }, "pull"],
      [{ ahead: 3, behind: 0 }, "push"],
      [{ ahead: 0, behind: 0 }, "fetch"],
    ])("suggests the remote action for %o", async (counts, expected) => {
      statusExtras = counts;
      const model = await renderModel();

      expect(model.current.suggestedRemote).toBe(expected);
    });

    it("clears stats when the working tree is clean", async () => {
      statusFiles = [];
      const model = await renderModel();

      expect(model.current.files).toEqual([]);
      expect(model.current.totals).toEqual({ additions: 0, deletions: 0 });
      expect(calls("git_status_diff_stats")).toEqual([]);
    });
  });

  describe("staging and discarding", () => {
    it("stages unique paths, marks them busy while running, then refreshes", async () => {
      const model = await renderModel();
      let release: () => void = () => {};
      const gate = new Promise<null>((resolve) => {
        release = () => resolve(null);
      });
      handlers.git_add = () => gate;
      const statusReadsBefore = calls("git_status").length;

      let staging!: Promise<void>;
      act(() => {
        staging = model.current.setStaged(model.current.unstaged.slice(0, 2), true);
      });
      await vi.waitFor(() => expect(calls("git_add")).toHaveLength(2));
      expect([...model.current.busyKeys]).toEqual(["unstaged:src/app.ts", "unstaged:README.md"]);
      release();
      await act(() => staging);

      expect(calls("git_add").map((args) => args?.filePath)).toEqual(["src/app.ts", "README.md"]);
      expect(model.current.busyKeys.size).toBe(0);
      expect(calls("git_status").length).toBeGreaterThan(statusReadsBefore);
    });

    it("unstages through reset and ignores empty selections", async () => {
      const model = await renderModel();

      await act(() => model.current.setStaged([], false));
      expect(calls("git_reset")).toEqual([]);

      await act(() => model.current.setStaged(model.current.staged, false));
      expect(calls("git_reset")).toEqual([{ repoPath: "/repo", filePath: "src/app.ts" }]);
    });

    it("discards only after confirmation and names the target", async () => {
      const model = await renderModel();
      mocks.confirm.mockResolvedValueOnce(false);

      await act(() => model.current.discard([model.current.unstaged[1]]));
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        "Discard changes in README.md? This can't be undone.",
        expect.objectContaining({ confirmLabel: "Discard" }),
      );
      expect(calls("git_discard_file_changes")).toEqual([]);

      await act(() => model.current.discard(model.current.unstaged.slice(0, 2)));
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        "Discard changes in 2 files? This can't be undone.",
        expect.anything(),
      );
      expect(calls("git_discard_file_changes").map((args) => args?.filePath)).toEqual([
        "src/app.ts",
        "README.md",
      ]);
    });
  });

  describe("opening files", () => {
    it("opens untracked files directly and diffs tracked ones", async () => {
      const model = await renderModel();

      await act(async () => model.current.openDiff(model.current.unstaged[2]));
      expect(onFileSelect).toHaveBeenCalledWith("/repo/notes/todo.txt", false);

      await act(async () => model.current.openDiff(model.current.staged[0]));
      await vi.waitFor(() => expect(mocks.openBuffer).toHaveBeenCalled());
      expect(calls("git_diff_file")).toEqual([
        { repoPath: "/repo", filePath: "src/app.ts", staged: true },
      ]);
    });

    it("opens the file itself on click when diff-on-click is off", async () => {
      setSettings({ openDiffOnClick: false });
      const model = await renderModel();

      await act(async () => model.current.openPrimary(model.current.staged[0]));

      expect(onFileSelect).toHaveBeenCalledWith("/repo/src/app.ts", false);
      expect(mocks.openBuffer).not.toHaveBeenCalled();
    });
  });

  describe("committing", () => {
    it("rejects blank messages", async () => {
      const model = await renderModel();
      let result: boolean | undefined;

      await act(async () => {
        result = await model.current.commit("   ");
      });

      expect(result).toBe(false);
      expect(calls("git_commit")).toEqual([]);
    });

    it("stages everything first when asked, commits the trimmed message and pushes", async () => {
      const model = await renderModel();
      let result: boolean | undefined;

      await act(async () => {
        result = await model.current.commit("  Ship it  ", { stageAll: true, andPush: true });
      });

      expect(result).toBe(true);
      expect(calls("git_add").map((args) => args?.filePath)).toEqual([
        "src/app.ts",
        "README.md",
        "notes/todo.txt",
      ]);
      expect(calls("git_commit")).toEqual([{ repoPath: "/repo", message: "Ship it" }]);
      expect(calls("git_push")).toEqual([{ repoPath: "/repo", branch: null, remote: "origin" }]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Committed");
      expect(mocks.toast.success).toHaveBeenCalledWith("Pushed");
      expect(model.current.isCommitting).toBe(false);
    });

    it("reports a failed commit and a failed push", async () => {
      const model = await renderModel();
      handlers.git_commit = () => {
        throw new Error("hook failed");
      };
      let result: boolean | undefined;

      await act(async () => {
        result = await model.current.commit("msg");
      });
      expect(result).toBe(false);
      expect(mocks.toast.error).toHaveBeenCalledWith("Commit failed");

      handlers.git_commit = () => null;
      handlers.git_push = () => {
        throw new Error("rejected");
      };
      await act(async () => {
        result = await model.current.commit("msg", { andPush: true });
      });
      expect(result).toBe(true);
      expect(mocks.toast.error).toHaveBeenCalledWith("rejected");
    });
  });

  describe("generating a commit message", () => {
    it("returns the first line of the generated message", async () => {
      mocks.requestInlineEdit.mockResolvedValue({ editedText: "```\nAdd parser\n\nMore\n```" });
      const model = await renderModel();
      let message: string | null | undefined;

      await act(async () => {
        message = await model.current.generateMessage("draft");
      });

      expect(message).toBe("Add parser");
      expect(mocks.requestInlineEdit).toHaveBeenCalledWith(
        expect.objectContaining({ model: "model-1", feature: "commit-message", filePath: "repo" }),
      );
      expect(model.current.isGenerating).toBe(false);
    });

    it("returns null when nothing is staged or the model returns nothing", async () => {
      mocks.requestInlineEdit.mockResolvedValue({ editedText: "  " });
      const model = await renderModel();
      let message: string | null | undefined = "unset";

      await act(async () => {
        message = await model.current.generateMessage("");
      });
      expect(message).toBeNull();

      statusFiles = statusFiles.filter((file) => !file.staged);
      await act(() => model.current.refresh());
      await settle();
      mocks.requestInlineEdit.mockClear();
      await act(async () => {
        message = await model.current.generateMessage("");
      });
      expect(message).toBeNull();
      expect(mocks.requestInlineEdit).not.toHaveBeenCalled();
    });

    it("shows the AI service's own error message", async () => {
      const { InlineEditError } =
        await import("@/features/ai/intelligence/services/intelligence-text-service");
      mocks.requestInlineEdit.mockRejectedValueOnce(new InlineEditError("Quota exceeded", 429));
      const model = await renderModel();

      await act(() => model.current.generateMessage(""));
      expect(mocks.toast.error).toHaveBeenLastCalledWith("Quota exceeded");

      mocks.requestInlineEdit.mockRejectedValueOnce(new Error("socket"));
      await act(() => model.current.generateMessage(""));
      expect(mocks.toast.error).toHaveBeenLastCalledWith("Failed to generate message");
    });
  });

  describe("remotes", () => {
    it.each([
      ["push", "git_push", "Pushed"],
      ["pull", "git_pull", "Pulled"],
      ["fetch", "git_fetch", "Fetched"],
    ] as const)("runs %s and reports success", async (action, command, message) => {
      const model = await renderModel();

      await act(() => model.current.runRemote(action));

      expect(calls(command)).toHaveLength(1);
      expect(mocks.toast.success).toHaveBeenCalledWith(message);
      expect(model.current.remoteAction).toBeNull();
    });

    it("reports remote failures and ignores a second action while one runs", async () => {
      const model = await renderModel();
      let release: () => void = () => {};
      handlers.git_fetch = () =>
        new Promise((_, reject) => {
          release = () => reject("Could not resolve host");
        });

      let running!: Promise<void>;
      act(() => {
        running = model.current.runRemote("fetch");
      });
      expect(model.current.remoteAction).toBe("fetch");
      await act(() => model.current.runRemote("push"));
      await vi.waitFor(() => expect(calls("git_fetch")).toHaveLength(1));
      release();
      await act(() => running);

      expect(calls("git_push")).toEqual([]);
      expect(mocks.toast.error).toHaveBeenCalledWith("Could not resolve host");
      expect(model.current.remoteAction).toBeNull();
    });
  });

  describe("branches", () => {
    it("switches branches and clears cached blame", async () => {
      const model = await renderModel();
      const clearAllBlame = vi.spyOn(useGitBlameStore.getState().actions, "clearAllBlame");

      await act(() => model.current.checkout("main"));
      expect(calls("git_checkout")).toEqual([]);

      await act(() => model.current.checkout("dev"));
      expect(calls("git_checkout")).toEqual([{ repoPath: "/repo", branchName: "dev" }]);
      expect(clearAllBlame).toHaveBeenCalled();
      expect(mocks.toast.success).toHaveBeenCalledWith("Switched to dev");
    });

    it("offers to stash local changes and retries the switch", async () => {
      const model = await renderModel();
      let attempts = 0;
      handlers.git_checkout = () => {
        attempts += 1;
        return attempts === 1
          ? { success: false, hasChanges: true, message: "Local changes would be overwritten" }
          : { success: true, hasChanges: false, message: "" };
      };

      await act(() => model.current.checkout("dev"));
      const [message, options] = mocks.toast.warning.mock.calls[0];
      expect(message).toBe("Local changes would be overwritten");
      expect(options.action.label).toBe("Stash & switch");

      await act(() => options.action.onClick());

      expect(calls("git_create_stash")).toEqual([
        { repoPath: "/repo", message: "Switching to dev", includeUntracked: true, files: null },
      ]);
      expect(calls("git_checkout")).toHaveLength(2);
      expect(mocks.toast.success).toHaveBeenCalledWith("Stashed changes and switched to dev");
    });

    it("stops when stashing fails and reports a failed retry", async () => {
      const model = await renderModel();
      handlers.git_checkout = () => ({ success: false, hasChanges: true, message: "dirty" });
      await act(() => model.current.checkout("dev"));
      const onClick = mocks.toast.warning.mock.calls[0][1].action.onClick;

      handlers.git_create_stash = () => {
        throw new Error("cannot stash");
      };
      await act(() => onClick());
      expect(mocks.toast.error).toHaveBeenLastCalledWith("Failed to stash changes");
      expect(calls("git_checkout")).toHaveLength(1);

      handlers.git_create_stash = () => null;
      handlers.git_checkout = () => ({ success: false, hasChanges: false, message: "" });
      await act(() => onClick());
      expect(mocks.toast.error).toHaveBeenLastCalledWith("Failed to switch to dev");
    });

    it("reports a plain checkout failure", async () => {
      const model = await renderModel();
      handlers.git_checkout = () => ({ success: false, hasChanges: false, message: "" });

      await act(() => model.current.checkout("dev"));

      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to switch to dev");
    });

    it("creates a branch from the current branch after prompting", async () => {
      const model = await renderModel();
      handlers.git_branches = () => ["main", "dev", "feature/new"];

      await act(() => model.current.createBranch());

      expect(mocks.prompt).toHaveBeenCalledWith(
        "Enter a name for the new branch.",
        expect.objectContaining({ title: "New branch from main" }),
      );
      expect(calls("git_create_branch")).toEqual([
        { repoPath: "/repo", branchName: "feature/new", fromBranch: "main" },
      ]);
      expect(useGitStore.getState().branches).toEqual(["main", "dev", "feature/new"]);
    });

    it("does not create a branch when the prompt is cancelled and reports failures", async () => {
      const model = await renderModel();
      mocks.prompt.mockResolvedValueOnce("  ");
      await act(() => model.current.createBranch("dev"));
      expect(calls("git_create_branch")).toEqual([]);

      handlers.git_create_branch = () => {
        throw new Error("exists");
      };
      await act(() => model.current.createBranch("dev"));
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to create branch");
    });

    it("deletes a branch after confirmation but never the current one", async () => {
      const model = await renderModel();
      handlers.git_branches = () => ["main"];

      await act(() => model.current.deleteBranch("main"));
      expect(mocks.confirm).not.toHaveBeenCalled();

      mocks.confirm.mockResolvedValueOnce(false);
      await act(() => model.current.deleteBranch("dev"));
      expect(calls("git_delete_branch")).toEqual([]);

      await act(() => model.current.deleteBranch("dev"));
      expect(calls("git_delete_branch")).toEqual([{ repoPath: "/repo", branchName: "dev" }]);
      expect(useGitStore.getState().branches).toEqual(["main"]);

      handlers.git_delete_branch = () => {
        throw new Error("not merged");
      };
      await act(() => model.current.deleteBranch("dev"));
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to delete branch");
    });
  });

  describe("stashes", () => {
    it("routes each stash kind to its command", async () => {
      const model = await renderModel();

      await act(() => model.current.stash("create", undefined, "wip", ["a.ts"]));
      await act(() => model.current.stash("apply", 2));
      await act(() => model.current.stash("pop"));
      await act(() => model.current.stash("drop"));

      expect(calls("git_create_stash")).toEqual([
        { repoPath: "/repo", message: "wip", includeUntracked: true, files: ["a.ts"] },
      ]);
      expect(calls("git_apply_stash")).toEqual([{ repoPath: "/repo", stashIndex: 2 }]);
      expect(calls("git_pop_stash")).toEqual([{ repoPath: "/repo", stashIndex: null }]);
      expect(calls("git_drop_stash")).toEqual([{ repoPath: "/repo", stashIndex: 0 }]);
      expect(mocks.toast.error).not.toHaveBeenCalled();
    });

    it("reports a failed stash operation", async () => {
      const model = await renderModel();
      handlers.git_pop_stash = () => {
        throw new Error("conflict");
      };

      await act(() => model.current.stash("pop", 1));

      expect(mocks.toast.error).toHaveBeenCalledWith("Stash pop failed");
    });
  });

  it("opens commit, stash and branch diffs through the diff actions", async () => {
    handlers.git_commit_diff = () => [{ file_path: "a.ts", lines: [] }];
    handlers.git_stash_diff = () => [{ file_path: "b.ts", lines: [] }];
    handlers.git_ref_diff = () => [{ file_path: "c.ts", lines: [] }];
    const model = await renderModel();

    await act(async () => {
      model.current.viewCommit("c1");
      model.current.viewStash(0);
      model.current.viewBranchDiff("dev");
      model.current.viewAll("unstaged");
    });
    await settle();

    const paths = mocks.openBuffer.mock.calls.map((call: unknown[]) => call[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "diff://commit/c1/all-files",
        "diff://stash/0/all-files",
        `diff://branch/${encodeURIComponent("dev..main")}/all-files`,
        "diff://working-tree/unstaged",
      ]),
    );
  });
});
